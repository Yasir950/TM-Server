import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStream, mediaDevices, type MediaStreamTrack } from "react-native-webrtc";
import InCallManager from "react-native-incall-manager";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, displayName, inDnd, meetingEnd, meetingLive, WEB_URL } from "./supabase";
import { useChat } from "./store";
import { answerSystemCall, endSystemCall, onSystemAnswer, onSystemHangup, startShareService, stopShareService, systemRinging } from "./callkit";

// Meet calls, compatible with the web and desktop apps (src/components/chat/Huddle.tsx and store.tsx):
// mesh WebRTC over Supabase Realtime. Room huddle:<channel>, one presence entry per device, the lower key offers,
// three fixed transceivers [mic, screen, camera] swapped with replaceTrack. Rings travel on the workspace "huddles" room.

type State = { muted: boolean; sharing: boolean; camera: boolean; hand: boolean };
type Signal = { from: string; to: string; sdp?: { type: string; sdp: string }; ice?: object };
export type Ring = { channelId: string; from: string; title: string; meeting?: string };
export type Person = { key: string; user: string; state: State; streams: (MediaStream | null | undefined)[]; self?: boolean; reaction?: string };

const MIC = 0;
const SCREEN = 1;
const CAMERA = 2;
const SLOTS = ["audio", "video", "video"] as const;
export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👏", "😮", "🙏", "🔥"];
const STATIC_ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const TAB = Math.random().toString(36).slice(2, 8);
let joins = 0;
const RING_WINDOW = 10 * 60_000;

async function iceServers() {
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch(`${WEB_URL}/api/turn`, { headers: { Authorization: `Bearer ${data.session?.access_token}` } });
    const body = await res.json();
    if (Array.isArray(body.iceServers) && body.iceServers.length) return [...STATIC_ICE, ...body.iceServers];
  } catch {}
  return STATIC_ICE;
}

const callLength = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
};

// The last one out posts the call summary (same message shape as the web app)
function logCall(channelId: string, userId: string, seconds: number, people: string[]) {
  const body = people.length > 1 ? `Call ended · ${callLength(seconds)}` : "Missed call";
  supabase.from("messages").insert({ channel_id: channelId, user_id: userId, body, blocks: [{ type: "call", duration: Math.round(seconds), people }], attachments: [], mentions: [] }).then();
}

type CallState = {
  huddle: string | null;
  // Channel id → ids of the people currently in its call, across the workspace
  huddles: Record<string, string[]>;
  ring: Ring | null;
  setRing: (r: Ring | null) => void;
  notice: string | null;
  join: (channelId: string | null) => void;
  dismissRing: (decline?: boolean) => void;
  invite: (userIds: string[]) => void;
  callName: (channelId: string) => string;
  // The live call
  people: Person[];
  connectedAt: number | null;
  error: string;
  me: State;
  speaker: boolean;
  toggle: (what: "muted" | "camera" | "hand") => void;
  setSpeaker: (on: boolean) => void;
  flipCamera: () => void;
  react: (emoji: string) => void;
  // Starts or stops sharing this phone's screen; on iOS showPicker opens the system broadcast picker first
  shareScreen: (showPicker?: () => void) => void;
};

const Ctx = createContext<CallState | null>(null);
export const useCall = () => useContext(Ctx)!;

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { uid, profiles, channels, dmMembers, meetings, plan, channelTitle } = useChat();
  const [huddle, setHuddle] = useState<string | null>(null);
  const [huddles, setHuddles] = useState<Record<string, string[]>>({});
  const [ring, setRing] = useState<Ring | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [rung, setRung] = useState<Record<string, number>>({});
  const live = useRef({ huddle, huddles, ring, profiles });
  live.current = { huddle, huddles, ring, profiles };

  const room = () => supabase.getChannels().find((c) => c.topic === "realtime:huddles");

  // Answered or hung up on the phone's own call screen (CallKit on iOS, the full-screen notification on Android)
  const joinRef = useRef<(id: string | null) => void>(() => {});
  useEffect(() => {
    const offAnswer = onSystemAnswer((a) => {
      if (a.answered) joinRef.current(a.channel);
      // Navigation may still be mounting after a cold start
      setTimeout(() => router.push(a.answered ? `/call/${a.channel}` : `/call/${a.channel}?from=${a.from ?? ""}`), 300);
    });
    const offHangup = onSystemHangup((channel) => live.current.huddle === channel && joinRef.current(null));
    return () => {
      offAnswer();
      offHangup();
    };
  }, []);

  // A ring that stops without being answered here takes the system call screen down too
  const lastRing = useRef<Ring | null>(null);
  useEffect(() => {
    const before = lastRing.current;
    lastRing.current = ring;
    if (before && before.channelId !== ring?.channelId && live.current.huddle !== before.channelId) endSystemCall(before.channelId);
  }, [ring]);

  // Workspace room: who is in which call, and rings
  useEffect(() => {
    const ch = supabase.channel("huddles", { config: { presence: { key: uid }, broadcast: { self: false } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ channel: string | null; tab?: string }>();
      const next: Record<string, string[]> = {};
      for (const [id, metas] of Object.entries(state)) for (const c of new Set(metas.map((m) => m.channel))) if (c) (next[c] ??= []).push(id);
      setHuddles(next);
      // Picked up on another device: stop ringing here
      const r = live.current.ring;
      if (r && (state[uid] ?? []).some((m) => m.channel === r.channelId && m.tab !== TAB)) setRing(null);
    })
      .on("broadcast", { event: "ring" }, ({ payload }) => {
        const r = payload as Ring & { to: string[] };
        const { huddle: h, huddles: hs, profiles: ps } = live.current;
        if (!r.to.includes(uid) || h === r.channelId || hs[r.channelId]?.includes(uid)) return;
        setTitles((t) => ({ ...t, [r.channelId]: r.title }));
        if (inDnd(ps[uid])) return;
        setRing({ channelId: r.channelId, from: r.from, title: r.title });
      })
      .on("broadcast", { event: "decline" }, ({ payload }) => {
        if (payload.to !== uid || payload.channelId !== live.current.huddle) return;
        setNotice(`${displayName(live.current.profiles[payload.from])} declined`);
        setRung((r) => Object.fromEntries(Object.entries(r).filter(([id]) => id !== payload.from)));
      })
      .on("broadcast", { event: "cancel" }, ({ payload }) => {
        if (Array.isArray(payload?.to) && payload.to.includes(uid)) setRing((r) => (r && !r.meeting && r.channelId === payload.channelId && r.from === payload.from ? null : r));
      })
      .on("broadcast", { event: "ring-handled" }, ({ payload }) => payload?.to === uid && setRing((r) => (r?.channelId === payload.channelId ? null : r)))
      .on("broadcast", { event: "leave-call" }, ({ payload }) => payload?.to === uid && payload.tab === TAB && setHuddle(null))
      .subscribe((s) => s === "SUBSCRIBED" && live.current.huddle && ch.track({ channel: live.current.huddle, tab: TAB, at: Date.now() }));
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid]);

  useEffect(() => {
    if (huddle) room()?.track({ channel: huddle, tab: TAB, at: Date.now() });
    else room()?.untrack();
  }, [huddle]);

  // Incoming ring: system ringtone until answered, declined or 30 seconds pass
  useEffect(() => {
    if (!ring) return;
    // CallKit is already ringing for it
    if (!systemRinging(ring.channelId)) InCallManager.startRingtone("_DEFAULT_", [0, 800, 800], "playback", 30);
    const t = setTimeout(() => setRing((r) => (r === ring ? null : r)), 30_000);
    return () => {
      clearTimeout(t);
      InCallManager.stopRingtone();
    };
  }, [ring]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const callName = useCallback((id: string) => {
    const c = channels[id];
    if (!c) return titles[id] ?? "a meet";
    return c.kind === "dm" ? channelTitle(c) : `#${c.name}`;
  }, [channels, channelTitle, titles]);

  const ringPeople = useCallback(
    (channelId: string, to: string[]) => {
      if (!to.length) return;
      room()?.send({ type: "broadcast", event: "ring", payload: { to, channelId, from: uid, title: callName(channelId) } });
      // Rings people whose app is closed, through push
      supabase.rpc("push_ring", { p_channel: channelId, p_to: to }).then();
      const at = Date.now();
      setRung((r) => ({ ...r, ...Object.fromEntries(to.map((id) => [id, at])) }));
      setTimeout(() => setRung((r) => Object.fromEntries(Object.entries(r).filter(([, t]) => t !== at))), 30_000);
    },
    [uid, callName],
  );

  const ringHandled = (channelId: string, answered: boolean) => {
    room()?.send({ type: "broadcast", event: "ring-handled", payload: { to: uid, channelId } });
    supabase.rpc("push_ring_handled", { p_channel: channelId, p_answered: answered }).then();
  };

  const join = useCallback(
    (channelId: string | null) => {
      // Calls are capped by the plan (Free: 1:1)
      const cap = plan?.max_call_participants;
      if (channelId && channelId !== huddle && cap && !(huddles[channelId] ?? []).includes(uid) && (huddles[channelId]?.length ?? 0) >= cap) {
        Alert.alert("This call is full", `The ${plan?.name} plan allows up to ${cap} people in a call${plan?.id === "free" ? "; upgrade to Pro for group calls" : ""}.`);
        return;
      }
      // Hanging up before anyone answered stops the ringing on their end
      const ringingNow = Object.keys(rung);
      if (huddle && huddle !== channelId && ringingNow.length && !(huddles[huddle] ?? []).some((id) => id !== uid)) {
        room()?.send({ type: "broadcast", event: "cancel", payload: { to: ringingNow, channelId: huddle, from: uid } });
        supabase.rpc("push_cancel_ring", { p_channel: huddle, p_to: ringingNow }).then();
      }
      // The system call screen follows: picked up here, or the call it ran has ended
      if (channelId) answerSystemCall(channelId);
      if (huddle && huddle !== channelId) endSystemCall(huddle);
      setHuddle(channelId);
      setRung({});
      setNotice(null);
      if (channelId && ring?.channelId === channelId) ringHandled(channelId, true);
      setRing((r) => (r?.channelId === channelId ? null : r));
      // Starting a call rings the others in the conversation, unless it's running or a meeting there is calling everyone
      const c = channelId ? channels[channelId] : undefined;
      if (!channelId || !c || huddles[channelId]?.length || meetings.some((m) => m.channel_id === channelId && meetingLive(m))) return;
      if (c.kind === "dm") ringPeople(channelId, (dmMembers[channelId] ?? []).filter((id) => id !== uid));
      else
        supabase
          .from("channel_members")
          .select("user_id")
          .eq("channel_id", channelId)
          .then(({ data }) => ringPeople(channelId, (data ?? []).map((r) => r.user_id).filter((id) => id !== uid)));
    },
    [uid, plan, huddle, huddles, rung, ring, channels, dmMembers, meetings, ringPeople], // eslint-disable-line react-hooks/exhaustive-deps
  );

  joinRef.current = join;

  const dismissRing = useCallback(
    (decline = false) => {
      if (decline && ring) {
        if (ring.from !== uid) room()?.send({ type: "broadcast", event: "decline", payload: { to: ring.from, from: uid, channelId: ring.channelId } });
        ringHandled(ring.channelId, false);
      }
      setRing(null);
    },
    [uid, ring], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const invite = useCallback((ids: string[]) => huddle && ringPeople(huddle, ids), [huddle, ringPeople]);

  // Scheduled meetings ring their invitees at the start time, once per device
  useEffect(() => {
    const check = async () => {
      const now = Date.now();
      for (const m of meetings) {
        const mine = m.meeting_invitees.find((i) => i.user_id === uid);
        if (!mine || mine.response === "declined" || m.cancelled_at) continue;
        const start = Date.parse(m.starts_at);
        if (now < start || now >= Math.min(meetingEnd(m), start + RING_WINDOW)) continue;
        const key = `tm:meeting:ring:${m.id}`;
        if (await AsyncStorage.getItem(key)) continue;
        await AsyncStorage.setItem(key, "1");
        const { huddle: h, huddles: hs, profiles: ps } = live.current;
        if (h === m.channel_id || hs[m.channel_id]?.includes(uid) || inDnd(ps[uid])) continue;
        setTitles((t) => ({ ...t, [m.channel_id]: m.title }));
        setRing({ channelId: m.channel_id, from: m.created_by, title: m.title, meeting: m.id });
      }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [meetings, uid]);

  const engine = useEngine(huddle, uid, () => setHuddle(null));

  const value = useMemo<CallState>(
    () => ({ huddle, huddles, ring, setRing, notice, join, dismissRing, invite, callName, ...engine }),
    [huddle, huddles, ring, notice, join, dismissRing, invite, callName, engine],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// The WebRTC side of the current call
function useEngine(channelId: string | null, uid: string, end: () => void) {
  const [present, setPresent] = useState<Record<string, State>>({});
  const [remotes, setRemotes] = useState<Record<string, (MediaStream | null)[]>>({});
  const [local, setLocal] = useState<(MediaStream | null)[]>([null, null, null]);
  const [mine, setMine] = useState<State>({ muted: false, sharing: false, camera: false, hand: false });
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [speaker, setSpeakerState] = useState(false);
  const [reactions, setReactions] = useState<Record<string, string>>({});
  const [selfKey, setSelfKey] = useState("");
  const tracks = useRef<(MediaStreamTrack | null)[]>([null, null, null]);
  const peers = useRef(new Map<string, { pc: RTCPeerConnection; chain: Promise<void> }>());
  const roomRef = useRef<RealtimeChannel | null>(null);
  const state = useRef(mine);
  state.current = mine;
  const extra = useRef<{ since: number; people: Set<string> }>({ since: 0, people: new Set() });

  const flash = (key: string, emoji: string) => {
    setReactions((r) => ({ ...r, [key]: emoji }));
    setTimeout(() => setReactions((r) => (r[key] === emoji ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== key)) : r)), 3000);
  };

  useEffect(() => {
    if (!channelId) return;
    let closed = false;
    const self = `${uid}:${TAB}${++joins}`;
    setSelfKey(self);
    const since = Date.now();
    let start = since;
    let joined = false;
    const attended = new Set([uid]);
    extra.current = { since, people: attended };
    const conns = peers.current;
    const sending = tracks.current;
    const ch = supabase.channel(`huddle:${channelId}`, { config: { presence: { key: self }, broadcast: { self: false } } });
    roomRef.current = ch;
    const send = (s: Omit<Signal, "from">) => ch.send({ type: "broadcast", event: "signal", payload: { ...s, from: self } });
    const run = (key: string, step: (pc: RTCPeerConnection) => Promise<void>) => {
      const p = conns.get(key);
      if (p) p.chain = p.chain.then(() => step(p.pc)).catch((e) => console.warn("call", e));
    };
    const offer = (key: string, iceRestart = false) =>
      run(key, async (pc) => {
        await pc.setLocalDescription(await pc.createOffer({ iceRestart } as never));
        send({ to: key, sdp: pc.localDescription!.toJSON() as Signal["sdp"] });
      });
    const attach = (pc: RTCPeerConnection) =>
      pc.getTransceivers().forEach((t, i) => {
        t.direction = "sendrecv";
        t.sender.replaceTrack(sending[i] ?? null).catch(() => {});
      });

    let ice: object[] = STATIC_ICE;
    const connect = (key: string) => {
      const pc = new RTCPeerConnection({ iceServers: ice as never });
      conns.set(key, { pc, chain: Promise.resolve() });
      pc.addEventListener("icecandidate", (e) => e.candidate && send({ to: key, ice: e.candidate.toJSON() }));
      pc.addEventListener("track", (e) => {
        // Which of the three slots this arrived on: mic, screen or camera
        const ev = e as unknown as { transceiver?: unknown };
        const slot = pc.getTransceivers().findIndex((t) => t === ev.transceiver || t.receiver.track?.id === e.track?.id);
        if (slot < 0 || !e.track) return;
        setRemotes((r) => {
          const streams = [...(r[key] ?? [null, null, null])];
          streams[slot] = new MediaStream([e.track!]);
          return { ...r, [key]: streams };
        });
      });
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" && self < key) offer(key, true);
      });
      return pc;
    };
    const drop = (key: string) => {
      conns.get(key)?.pc.close();
      conns.delete(key);
      setRemotes((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== key)));
    };
    const onSignal = ({ from, to, sdp, ice: cand }: Signal) => {
      if (to !== self || closed) return;
      if (!conns.has(from)) {
        if (sdp?.type !== "offer") return;
        connect(from);
      }
      run(from, async (pc) => {
        if (sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp as never));
          if (sdp.type !== "offer") return;
          attach(pc);
          await pc.setLocalDescription(await pc.createAnswer());
          send({ to: from, sdp: pc.localDescription!.toJSON() as Signal["sdp"] });
        } else if (cand && pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(cand as never));
      });
    };

    InCallManager.start({ media: "audio" });
    (async () => {
      const servers = iceServers().then((s) => (ice = s));
      try {
        const mic = await mediaDevices.getUserMedia({ audio: true, video: false });
        if (closed) return mic.getTracks().forEach((t) => t.stop());
        sending[MIC] = mic.getAudioTracks()[0];
        sending[MIC]!.enabled = !state.current.muted;
        setLocal((l) => [mic, l[1], l[2]]);
      } catch {
        setError("Microphone unavailable. You can still listen.");
      }
      await servers;
      if (closed) return;
      ch.on("presence", { event: "sync" }, () => {
        const others: Record<string, State> = {};
        const before = attended.size;
        for (const [key, [m]] of Object.entries(ch.presenceState<State & { since?: number; people?: string[] }>())) {
          if (typeof m?.since === "number") start = Math.min(start, m.since);
          attended.add(key.split(":")[0]);
          if (Array.isArray(m?.people)) for (const id of m.people) if (typeof id === "string") attended.add(id);
          if (key !== self) others[key] = { muted: !!m?.muted, sharing: !!m?.sharing, camera: !!m?.camera, hand: !!m?.hand };
        }
        if (attended.size > before) ch.track({ ...state.current, since, people: [...attended] });
        setPresent(others);
        if (Object.keys(others).length) {
          setConnectedAt((t) => t ?? Date.now());
          InCallManager.stopRingback();
        }
        for (const key of Object.keys(others))
          if (!conns.has(key) && self < key) {
            const pc = connect(key);
            SLOTS.forEach((kind) => pc.addTransceiver(kind, { direction: "sendrecv" }));
            attach(pc);
            offer(key);
          }
      })
        .on("presence", { event: "leave" }, ({ key, currentPresences }) => {
          if (!currentPresences?.length) drop(key);
        })
        .on("broadcast", { event: "signal" }, ({ payload }) => onSignal(payload as Signal))
        .on("broadcast", { event: "react" }, ({ payload }) => typeof payload?.from === "string" && REACTIONS.includes(payload.emoji) && flash(payload.from, payload.emoji))
        .subscribe((status) => {
          if (status !== "SUBSCRIBED") return;
          joined = true;
          ch.track({ ...state.current, since, people: [...attended] });
        });
    })();

    return () => {
      closed = true;
      if (joined && Object.keys(ch.presenceState()).every((k) => k === self)) logCall(channelId, uid, (Date.now() - start) / 1000, [...attended]);
      conns.forEach((p) => p.pc.close());
      conns.clear();
      sending.forEach((t) => t?.stop());
      sending.fill(null);
      roomRef.current = null;
      supabase.removeChannel(ch);
      InCallManager.stop();
      stopShareService();
      setPresent({});
      setRemotes({});
      setLocal([null, null, null]);
      setConnectedAt(null);
      setError("");
      setMine({ muted: false, sharing: false, camera: false, hand: false });
    };
  }, [channelId, uid]);

  // Ringback while nobody has picked up, for up to 30 seconds; then the call ends unanswered
  useEffect(() => {
    if (!channelId || connectedAt) return;
    InCallManager.startRingback("_DTMF_");
    const t = setTimeout(() => {
      InCallManager.stopRingback();
      if (!Object.keys(present).length) end();
    }, 30_000);
    return () => {
      clearTimeout(t);
      InCallManager.stopRingback();
    };
  }, [channelId, connectedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const publish = (next: State) => {
    setMine(next);
    roomRef.current?.track({ ...next, since: extra.current.since, people: [...extra.current.people] });
  };
  // A new track goes out on its slot to everyone already connected
  const swap = (slot: number, track: MediaStreamTrack | null) => {
    tracks.current[slot] = track;
    peers.current.forEach(({ pc }) => pc.getTransceivers()[slot]?.sender.replaceTrack(track).catch(() => {}));
  };

  const toggle = useCallback(
    async (what: "muted" | "camera" | "hand") => {
      const cur = state.current;
      if (what === "muted") {
        if (tracks.current[MIC]) tracks.current[MIC]!.enabled = cur.muted;
        return publish({ ...cur, muted: !cur.muted });
      }
      if (what === "hand") return publish({ ...cur, hand: !cur.hand });
      if (cur.camera) {
        tracks.current[CAMERA]?.stop();
        swap(CAMERA, null);
        setLocal((l) => [l[0], l[1], null]);
        return publish({ ...cur, camera: false });
      }
      try {
        const cam = await mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: 640, height: 480, frameRate: 24 } });
        swap(CAMERA, cam.getVideoTracks()[0]);
        setLocal((l) => [l[0], l[1], cam]);
        publish({ ...cur, camera: true });
        setSpeakerState(true);
        InCallManager.setForceSpeakerphoneOn(true);
      } catch {
        Alert.alert("Camera unavailable", "Allow camera access in Settings to turn on video.");
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const stopShare = useCallback(() => {
    if (!state.current.sharing && !tracks.current[SCREEN]) return;
    tracks.current[SCREEN]?.stop();
    swap(SCREEN, null);
    setLocal((l) => [l[0], null, l[2]]);
    stopShareService();
    publish({ ...state.current, sharing: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The screen goes out on the screen slot, like a desktop share: Android through MediaProjection (inside a
  // foreground service), iOS through the ReplayKit broadcast extension in targets/broadcast
  const shareScreen = useCallback(
    async (showPicker?: () => void) => {
      if (state.current.sharing) return stopShare();
      try {
        await startShareService();
        if (Platform.OS === "ios") showPicker?.();
        const screen = await mediaDevices.getDisplayMedia();
        const track = screen.getVideoTracks()[0];
        // Stopped from the system (iOS Control Center, Android's cast notification)
        (track as unknown as { addEventListener: (e: string, cb: () => void) => void }).addEventListener("ended", stopShare);
        swap(SCREEN, track);
        setLocal((l) => [l[0], screen, l[2]]);
        publish({ ...state.current, sharing: true });
      } catch {
        stopShareService();
        Alert.alert("Screen sharing didn't start", "Allow screen recording when asked, then try again.");
      }
    },
    [stopShare], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const flipCamera = useCallback(() => {
    const t = tracks.current[CAMERA] as unknown as { _switchCamera?: () => void } | null;
    t?._switchCamera?.();
  }, []);

  const setSpeaker = useCallback((on: boolean) => {
    setSpeakerState(on);
    InCallManager.setForceSpeakerphoneOn(on);
  }, []);

  const react = useCallback(
    (emoji: string) => {
      roomRef.current?.send({ type: "broadcast", event: "react", payload: { from: selfKey, emoji } });
      flash(selfKey, emoji);
    },
    [selfKey],
  );

  const people: Person[] = useMemo(
    () =>
      channelId
        ? [
            { key: selfKey, user: uid, state: mine, streams: local, self: true, reaction: reactions[selfKey] },
            ...Object.entries(present).map(([key, st]) => ({ key, user: key.split(":")[0], state: st, streams: remotes[key] ?? [], reaction: reactions[key] })),
          ]
        : [],
    [channelId, selfKey, uid, mine, local, present, remotes, reactions],
  );

  return useMemo(
    () => ({ people, connectedAt, error, me: mine, speaker, toggle, setSpeaker, flipCamera, react, shareScreen }),
    [people, connectedAt, error, mine, speaker, toggle, setSpeaker, flipCamera, react, shareScreen],
  );
}
