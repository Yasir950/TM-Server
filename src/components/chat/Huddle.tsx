"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, displayName, inDnd, type Profile } from "@/lib/supabase";
import { CALL, call } from "@/lib/brand";
import { callLength } from "@/lib/format";
import { Avatar, Modal, input } from "../ui";
import { Icon } from "../icons";
import { useChat, huddleHandoff, RESUME_KEY, type Ring } from "./store";

// Like a Slack huddle, the call gets its own window: an ordinary one, so it can go to any screen,
// be maximized or go full screen
const POPUP = { width: 520, height: 420 };

// Browsers only let a page open a window shortly after a click (the desktop app always can)
function canOpenWindow() {
  const activation = (
    navigator as Navigator & { userActivation?: { isActive: boolean } }
  ).userActivation;
  return !!window.workchime || !activation || activation.isActive;
}

function openCallWindow(): Window | null {
  // Opens near the top right of the app, from where it can be dragged anywhere
  const left = Math.max(
    0,
    Math.round(window.screenX + window.outerWidth - POPUP.width - 32),
  );
  const top = Math.round(window.screenY + 96);
  // A page of the app's own (public/call.html), so the window shows the app's address, not about:blank
  return window.open(
    "/call.html",
    "tm-call",
    `popup,width=${POPUP.width},height=${POPUP.height},left=${left},top=${top}`,
  );
}

// Calls back once the window has loaded call.html (and not a page it showed before)
function whenCallWindowReady(w: Window, ready: () => void) {
  const started = Date.now();
  const t = setInterval(() => {
    if (w.closed || Date.now() - started > 15_000) return clearInterval(t);
    try {
      const body = w.document.body;
      if (
        w.document.readyState !== "complete" ||
        !body?.hasAttribute("data-call-window") ||
        body.hasAttribute("data-dressed")
      )
        return;
    } catch {
      return;
    }
    clearInterval(t);
    ready();
  }, 50);
  return () => clearInterval(t);
}

// The window's page is bare: give it this page's stylesheets and root classes (fonts, theme)
function dressCallWindow(w: Window, title: string) {
  const d = w.document;
  d.head.replaceChildren();
  d.body.replaceChildren();
  d.body.setAttribute("data-dressed", "");
  d.title = title;
  const icon = d.createElement("link");
  icon.rel = "icon";
  icon.href = "/asset/AppIcon.svg";
  d.head.append(icon);
  for (const el of document.querySelectorAll<HTMLElement>(
    'link[rel="stylesheet"], style',
  )) {
    if (el instanceof HTMLLinkElement) {
      const link = d.createElement("link");
      link.rel = "stylesheet";
      link.href = el.href;
      d.head.append(link);
    } else d.head.append(el.cloneNode(true));
  }
  d.documentElement.className = document.documentElement.className;
  d.documentElement.style.cssText = `${document.documentElement.style.cssText};height:100%`;
  d.body.className = document.body.className;
  d.body.style.cssText =
    "margin:0;height:100%;overflow:hidden;background:#fff;color:#18181b";
}

// Mesh WebRTC: every participant connects to every other; Supabase Realtime carries the signaling.
// People behind strict NATs or firewalls can only connect through a TURN relay: /api/turn hands out
// short-lived relay credentials, and NEXT_PUBLIC_TURN_* still works for a self-hosted relay.
const turn = process.env.NEXT_PUBLIC_TURN_URL;
const STATIC_ICE: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ...(turn ? [{ urls: turn.split(","), username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL }] : []),
];

async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch("/api/turn", { headers: { Authorization: `Bearer ${data.session?.access_token}` }, cache: "no-store" });
    const body = (await res.json()) as { iceServers?: RTCIceServer[] };
    if (Array.isArray(body.iceServers) && body.iceServers.length) return [...STATIC_ICE, ...body.iceServers];
  } catch {}
  return STATIC_ICE;
}

// Every connection carries three fixed slots. Muting, sharing or turning on the camera swaps a
// track in or out with replaceTrack, so a call is negotiated once and never mid-call.
const SLOTS = ["audio", "video", "video"] as const;
const MIC = 0;
const SCREEN = 1;
const CAMERA = 2;

type State = { muted: boolean; sharing: boolean; camera: boolean; hand: boolean };
type Signal = { from: string; to: string; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
type Peer = { pc: RTCPeerConnection; chain: Promise<void> };
type Reaction = { emoji: string; id: number };
type Person = { key: string; user: string; state: State; streams: (MediaStream | null | undefined)[]; self?: boolean; reaction?: Reaction };

const REACTIONS = ["👍", "❤️", "😂", "🎉", "👏", "😮", "🙏", "🔥"];

// Shows a reaction over someone for three seconds; a newer one replaces it
function flash(set: React.Dispatch<React.SetStateAction<Record<string, Reaction>>>, key: string, emoji: string) {
  const id = Math.random();
  set((r) => ({ ...r, [key]: { emoji, id } }));
  setTimeout(() => set((r) => (r[key]?.id === id ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== key)) : r)), 3000);
}

// Each join gets its own presence key, so a reload or a second tab is a fresh peer
const tab = Math.random().toString(36).slice(2, 8);
let joins = 0;

// One shared audio context, unlocked by the first click or key press so rings can play later
// from a realtime event (browsers block audio that starts without a user gesture)
let ac: AudioContext | null = null;
const audio = () => (ac ??= new AudioContext());
if (typeof window !== "undefined") {
  const unlock = () => audio().resume().catch(() => {});
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

// Plays [frequency, start, length] notes; notes sharing a start sound together
function tone(notes: [number, number, number][], volume: number) {
  try {
    const ctx = audio();
    ctx.resume().catch(() => {});
    for (const [f, at, len] of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      const t = ctx.currentTime + at;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume, t + 0.02);
      g.gain.setValueAtTime(volume, t + len - 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + len + 0.05);
    }
  } catch {}
}

// Incoming call: a bright rising arpeggio, played twice
const ringtone = () =>
  tone([[659, 0, 0.15], [784, 0.15, 0.15], [988, 0.3, 0.3], [659, 0.8, 0.15], [784, 0.95, 0.15], [988, 1.1, 0.3]], 0.16);
// Outgoing call: the classic two-tone ringback while waiting for an answer
const ringback = () => tone([[440, 0, 1.2], [480, 0, 1.2]], 0.04);
const joinSound = () => tone([[523, 0, 0.12], [784, 0.1, 0.2]], 0.08);
const leaveSound = () => tone([[784, 0, 0.12], [523, 0.1, 0.2]], 0.08);
const handSound = () => tone([[880, 0, 0.12], [1175, 0.1, 0.18]], 0.06);

// Leaves a "Call happened" card in the conversation; the body is the notification and search fallback
function logCall(channelId: string, userId: string, seconds: number, people: string[]) {
  const body = people.length > 1 ? `📞 Call ended · ${callLength(seconds)}` : "📞 Missed call";
  supabase
    .from("messages")
    .insert({ channel_id: channelId, user_id: userId, body, blocks: [{ type: "call", duration: Math.round(seconds), people }], attachments: [], mentions: [] })
    .then(({ error }) => error && console.warn("huddle", error));
}

// True while the stream is carrying voice
function useSpeaking(stream: MediaStream | null | undefined, live: boolean) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!stream?.getAudioTracks().length || !live) return;
    const meter = audio();
    meter.resume().catch(() => {});
    const source = meter.createMediaStreamSource(stream);
    const analyser = meter.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const t = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) ** 2;
      setSpeaking(Math.sqrt(sum / buf.length) > 4);
    }, 150);
    return () => {
      clearInterval(t);
      source.disconnect();
    };
  }, [stream, live]);
  return live && speaking;
}

function Video({ stream, mirror, contain }: { stream: MediaStream; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={`h-full w-full bg-black ${contain ? "object-contain" : "object-cover"} ${mirror ? "-scale-x-100" : ""}`} />;
}

function Sound({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function Face({ p, profile }: { p: Person; profile?: Profile }) {
  const speaking = useSpeaking(p.streams[MIC], !p.state.muted);
  return (
    <span className={`relative rounded-[30%] ring-2 ring-offset-2 transition ${speaking ? "ring-tm-green" : p.state.hand ? "ring-amber-400" : "ring-transparent"}`} title={displayName(profile)}>
      <Avatar profile={profile} size={44} />
      {p.state.hand && (
        <span className="absolute -top-2 -left-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-white" title="Hand raised">
          <Icon name="hand" size={11} />
        </span>
      )}
      {p.state.muted && (
        <span className="absolute -right-2 -bottom-2 flex h-5 w-5 items-center justify-center rounded-full border border-tm-line bg-white text-zinc-600">
          <Icon name="micOff" size={10} />
        </span>
      )}
      {p.state.sharing && (
        <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-tm-line bg-white text-zinc-600">
          <Icon name="monitor" size={10} />
        </span>
      )}
      {p.reaction && (
        <span key={p.reaction.id} className="tm-rise pointer-events-none absolute inset-x-0 -top-8 text-center text-2xl leading-none">
          {p.reaction.emoji}
        </span>
      )}
    </span>
  );
}

// Call window: a person filling their grid cell, avatar centered with a glow while they talk
function WindowTile({
  p,
  profile,
  compact,
}: {
  p: Person;
  profile?: Profile;
  compact?: boolean;
}) {
  const speaking = useSpeaking(p.streams[MIC], !p.state.muted);
  const cam = p.state.camera ? p.streams[CAMERA] : null;
  return (
    <div
      className={`relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-2xl ring-2 transition ${speaking ? "ring-tm-green" : p.state.hand ? "ring-amber-400" : "ring-tm-blue/25"}`}
      style={{
        background: "linear-gradient(160deg, #ecfdf5 0%, #eff6ff 100%)",
      }}
    >
      {cam ? (
        <Video stream={cam} mirror={p.self} />
      ) : (
        <span
          className={`rounded-[30%] transition-shadow duration-300 ${speaking ? "shadow-[0_0_0_6px_rgba(34,197,94,0.35)]" : ""}`}
        >
          <Avatar profile={profile} size={compact ? 56 : 96} />
        </span>
      )}
      {p.state.hand && (
        <span className="absolute top-2.5 left-2.5 flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-slate-900">
          <Icon name="hand" size={12} />
          {!compact && "Hand raised"}
        </span>
      )}
      {p.reaction && (
        <span
          key={p.reaction.id}
          className={`tm-rise pointer-events-none absolute inset-x-0 bottom-10 text-center leading-none ${compact ? "text-3xl" : "text-5xl"}`}
        >
          {p.reaction.emoji}
        </span>
      )}
      <span
        className={`absolute bottom-2.5 left-2.5 flex max-w-[85%] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur ${cam ? "bg-black/45 text-white" : "bg-white/90 text-zinc-800 ring-1 ring-zinc-200/80"}`}
      >
        {p.state.muted && (
          <Icon name="micOff" size={12} className="text-red-500" />
        )}
        <span className="truncate">
          {displayName(profile)}
          {p.self && <span className="opacity-60"> (you)</span>}
        </span>
      </span>
    </div>
  );
}

// m:ss (or h:mm:ss) since the call connected, ticking
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <span className="tabular-nums">
      {h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`}
    </span>
  );
}

// fill: takes the whole grid cell (the call window) instead of a 16:9 box
function Tile({
  p,
  profile,
  small,
  fill,
}: {
  p: Person;
  profile?: Profile;
  small?: boolean;
  fill?: boolean;
}) {
  const speaking = useSpeaking(p.streams[MIC], !p.state.muted);
  const cam = p.state.camera ? p.streams[CAMERA] : null;
  return (
    <div
      className={`relative flex ${fill ? "h-full min-h-0 w-full" : "aspect-video shrink-0"} items-center justify-center overflow-hidden rounded-2xl bg-slate-800 ring-2 transition ${speaking ? "ring-tm-green" : p.state.hand ? "ring-amber-400" : "ring-transparent"}`}
    >
      {cam ? (
        <Video stream={cam} mirror={p.self} />
      ) : (
        <Avatar profile={profile} size={small ? 44 : 80} />
      )}
      {p.state.hand && (
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-lg bg-amber-400 px-2 py-0.5 text-xs font-semibold text-slate-900">
          <Icon name="hand" size={12} />
          {!small && "Hand raised"}
        </span>
      )}
      {p.reaction && (
        <span key={p.reaction.id} className={`tm-rise pointer-events-none absolute inset-x-0 bottom-8 text-center leading-none ${small ? "text-3xl" : "text-5xl"}`}>
          {p.reaction.emoji}
        </span>
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1 rounded-lg bg-black/55 px-2 py-0.5 text-xs">
        {p.state.muted && <Icon name="micOff" size={12} />}
        <span className="truncate">
          {displayName(profile)}
          {p.self && " (you)"}
        </span>
      </span>
    </div>
  );
}

function Btn({ dark, on, danger, disabled, title, onClick, children }: { dark?: boolean; on?: boolean; danger?: boolean; disabled?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  const tone = danger
    ? "bg-red-500 px-3.5 font-semibold text-white hover:bg-red-600"
    : on
      ? dark ? "bg-white text-slate-900" : "bg-zinc-800 text-white"
      : dark ? "bg-white/10 hover:bg-white/20" : "border border-tm-line text-zinc-600 hover:bg-tm-surface";
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={title} className={`flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-xl text-sm transition active:scale-95 disabled:opacity-40 ${tone}`}>
      {children}
    </button>
  );
}

export default function Huddle({
  channelId,
  onLeave,
}: {
  channelId: string;
  onLeave: () => void;
}) {
  const {
    me,
    profiles,
    channels,
    dmMembers,
    huddleName,
    huddleNotice,
    huddleResume,
  } = useChat();
  // When someone else first joined, for the call timer
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  // Rejoining after a reload: keep the mute, and don't play ringback as if calling anew
  const [resumed] = useState(() => (huddleResume?.channelId === channelId ? huddleResume : null));
  const [present, setPresent] = useState<Record<string, State>>({});
  const [remotes, setRemotes] = useState<Record<string, MediaStream[]>>({});
  const [mine, setMine] = useState<State>({ muted: !!resumed?.muted, sharing: false, camera: false, hand: false });
  // The separate call window, while the call is popped out of the app
  const [popout, setPopout] = useState<Window | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});
  const [picking, setPicking] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const selfKey = useRef("");
  const [local, setLocal] = useState<(MediaStream | null)[]>([null, null, null]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [unanswered, setUnanswered] = useState(false);
  // Where the minimized box was dragged to; null keeps it docked bottom-left
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("tm:huddle-pos") ?? "null");
    } catch {
      return null;
    }
  });
  const box = useRef<HTMLDivElement>(null);
  const tracks = useRef<(MediaStreamTrack | null)[]>([null, null, null]);
  const state = useRef(mine);
  const peers = useRef(new Map<string, Peer>());
  const room = useRef<RealtimeChannel | null>(null);
  const joinedAt = useRef(0);
  const attendees = useRef(new Set<string>());

  useEffect(() => {
    let closed = false;
    const self = `${me.id}:${tab}${++joins}`;
    // Everyone publishes when they joined; the earliest join anyone has seen is when the call began
    const since = Date.now();
    joinedAt.current = since;
    let start = since;
    let joined = false;
    // Everyone who has been in the call, shared in presence so the last one out knows all of them
    const attended = new Set([me.id]);
    attendees.current = attended;
    selfKey.current = self;
    const conns = peers.current;
    const sending = tracks.current;
    const ch = supabase.channel(`huddle:${channelId}`, { config: { presence: { key: self }, broadcast: { self: false } } });
    room.current = ch;
    const send = (s: Omit<Signal, "from">) => ch.send({ type: "broadcast", event: "signal", payload: { ...s, from: self } });

    // Signaling steps for one peer run strictly in order
    const run = (key: string, step: (pc: RTCPeerConnection) => Promise<void>) => {
      const peer = conns.get(key);
      if (peer) peer.chain = peer.chain.then(() => step(peer.pc)).catch((e) => console.warn("huddle", e));
    };

    const offer = (key: string, iceRestart = false) =>
      run(key, async (pc) => {
        await pc.setLocalDescription(await pc.createOffer({ iceRestart }));
        send({ to: key, sdp: pc.localDescription!.toJSON() });
      });

    // Our current mic, screen and camera go out on their slots; theirs come back on the same ones
    const attach = (pc: RTCPeerConnection) =>
      pc.getTransceivers().forEach((t, i) => {
        t.direction = "sendrecv";
        t.sender.replaceTrack(sending[i]).catch(() => {});
      });

    let ice = STATIC_ICE;
    const connect = (key: string) => {
      const pc = new RTCPeerConnection({ iceServers: ice });
      conns.set(key, { pc, chain: Promise.resolve() });
      pc.onicecandidate = (e) => e.candidate && send({ to: key, ice: e.candidate.toJSON() });
      pc.ontrack = ({ track, transceiver }) => {
        const slot = pc.getTransceivers().indexOf(transceiver);
        setRemotes((r) => {
          const streams = [...(r[key] ?? [])];
          streams[slot] = new MediaStream([track]);
          return { ...r, [key]: streams };
        });
      };
      // The side that made the offer restarts ICE when the network path breaks
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" && self < key) offer(key, true);
      };
      return pc;
    };

    const drop = (key: string) => {
      conns.get(key)?.pc.close();
      conns.delete(key);
      setRemotes((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== key)));
    };

    const onSignal = ({ from, to, sdp, ice }: Signal) => {
      if (to !== self || closed) return;
      if (!conns.has(from)) {
        if (sdp?.type !== "offer") return;
        connect(from);
      }
      run(from, async (pc) => {
        if (sdp) {
          await pc.setRemoteDescription(sdp);
          if (sdp.type !== "offer") return;
          attach(pc);
          await pc.setLocalDescription(await pc.createAnswer());
          send({ to: from, sdp: pc.localDescription!.toJSON() });
        } else if (ice && pc.remoteDescription) await pc.addIceCandidate(ice);
      });
    };

    let sharers = new Set<string>();
    let hands = new Set<string>();
    let seen = new Set<string>();
    (async () => {
      // Relay credentials load while the mic permission prompt is up
      const servers = iceServers().then((s) => (ice = s));
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (closed) return mic.getTracks().forEach((t) => t.stop());
        sending[MIC] = mic.getAudioTracks()[0];
        sending[MIC].enabled = !state.current.muted;
        setLocal((l) => [mic, l[SCREEN], l[CAMERA]]);
      } catch {
        setError("Microphone unavailable. You can still listen and share your screen.");
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
        if (Object.keys(others).length) setConnectedAt((t) => t ?? Date.now());
        const keys = Object.keys(others);
        if (keys.some((k) => !seen.has(k))) joinSound();
        else if ([...seen].some((k) => !others[k])) leaveSound();
        else if (keys.some((k) => others[k].hand && !hands.has(k))) handSound();
        seen = new Set(keys);
        hands = new Set(keys.filter((k) => others[k].hand));
        // Bring the stage up when someone starts sharing their screen
        const started = Object.keys(others).find((k) => others[k].sharing && !sharers.has(k));
        sharers = new Set(Object.keys(others).filter((k) => others[k].sharing));
        if (started) {
          setExpanded(true);
          setFocus(started);
        }
        // Only the lower key offers, so two peers never offer to each other at once
        for (const key of Object.keys(others))
          if (!conns.has(key) && self < key) {
            const pc = connect(key);
            SLOTS.forEach((kind) => pc.addTransceiver(kind));
            attach(pc);
            offer(key);
          }
      })
        // Re-tracking (mute, camera, share, hand, a new attendee) arrives as a leave of the old entry
        // alongside a join of the new one; only drop the connection once the key has no entries left
        .on("presence", { event: "leave" }, ({ key, currentPresences }) => {
          if (!currentPresences?.length) drop(key);
        })
        .on("broadcast", { event: "signal" }, ({ payload }) => onSignal(payload as Signal))
        .on("broadcast", { event: "react" }, ({ payload }) => {
          if (typeof payload?.from === "string" && REACTIONS.includes(payload.emoji)) flash(setReactions, payload.from, payload.emoji);
        })
        .subscribe((status) => {
          if (status !== "SUBSCRIBED") return;
          joined = true;
          ch.track({ ...state.current, since, people: [...attended] });
        });
    })();

    // A reload rejoins the call (see RESUME_KEY in store); tab close leaves it for good after the window
    const save = () => {
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify({ channelId, muted: state.current.muted, at: Date.now() }));
      } catch {}
    };
    window.addEventListener("pagehide", save);

    return () => {
      closed = true;
      window.removeEventListener("pagehide", save);
      // Handing the call to another tab of this browser isn't the call ending
      const handoff = huddleHandoff.current;
      huddleHandoff.current = false;
      // The last one out logs the call, whether or not anyone picked up
      if (!handoff && joined && Object.keys(ch.presenceState()).every((k) => k === self)) logCall(channelId, me.id, (Date.now() - start) / 1000, [...attended]);
      conns.forEach((p) => p.pc.close());
      conns.clear();
      sending.forEach((t) => t?.stop());
      sending.fill(null);
      room.current = null;
      supabase.removeChannel(ch);
    };
  }, [channelId, me.id]);

  // Calling the conversation: ringback until someone picks up, for up to 30 seconds
  const calling = !!channels[channelId] && Object.keys(present).length === 0 && !unanswered && !resumed;
  useEffect(() => {
    if (!calling) return;
    ringback();
    const t = setInterval(ringback, 3000);
    const giveUp = setTimeout(() => setUnanswered(true), 30_000);
    return () => {
      clearInterval(t);
      clearTimeout(giveUp);
    };
  }, [calling]);

  // The reaction picker closes on any click outside it
  useEffect(() => {
    if (!picking) return;
    const close = (e: PointerEvent) => {
      if (!picker.current?.contains(e.target as Node)) setPicking(false);
    };
    const win = popout ?? window;
    win.addEventListener("pointerdown", close);
    return () => win.removeEventListener("pointerdown", close);
  }, [picking, popout]);

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || !box.current) return;
    e.preventDefault();
    // Captured, so the drag keeps reporting the pointer after it leaves the browser window
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    const rect = box.current.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    let last: { x: number; y: number } | null = null;
    const move = (ev: PointerEvent) => {
      // A box in the page can't leave the browser window: dragging it off the edge pops the call
      // out into its own window, which can then go to another screen
      if (
        ev.clientX <= 0 ||
        ev.clientY <= 0 ||
        ev.clientX >= window.innerWidth - 1 ||
        ev.clientY >= window.innerHeight - 1
      ) {
        up();
        openWindow();
        return;
      }
      last = {
        x: Math.round(Math.min(Math.max(8, ev.clientX - dx), window.innerWidth - rect.width - 8)),
        y: Math.round(Math.min(Math.max(8, ev.clientY - dy), window.innerHeight - rect.height - 8)),
      };
      setPos(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        if (last) localStorage.setItem("tm:huddle-pos", JSON.stringify(last));
      } catch {}
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resetPos = () => {
    setPos(null);
    try {
      localStorage.removeItem("tm:huddle-pos");
    } catch {}
  };

  // The window being opened, until its page has loaded; closed with the call if it ends first.
  // Checked a moment after unmount, since React's development double mount unmounts and remounts at once.
  const opening = useRef<{ w: Window; cancel: () => void } | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (mounted.current) return;
        opening.current?.cancel();
        opening.current?.w.close();
        opening.current = null;
      }, 0);
    };
  }, []);

  const openWindow = () => {
    if (opening.current) return opening.current.w.focus();
    const w = openCallWindow();
    if (!w) return;
    // Closed before it finished loading
    const gone = setInterval(() => {
      if (!w.closed) return;
      clearInterval(gone);
      if (opening.current?.w === w) opening.current = null;
    }, 500);
    const cancel = whenCallWindowReady(w, () => {
      clearInterval(gone);
      opening.current = null;
      dressCallWindow(w, `${CALL} · ${huddleName(channelId)}`);
      setPopout(w);
    });
    opening.current = {
      w,
      cancel: () => {
        cancel();
        clearInterval(gone);
      },
    };
  };

  // Like a Slack huddle, the call opens in its own window by itself. The click that started or joined
  // the call allows it; after a reload there was no click, so it opens with the next click in the app.
  const autoOpened = useRef(false);
  const waitingForClick = useRef(false);
  useEffect(() => {
    if (!autoOpened.current) {
      autoOpened.current = true;
      if (canOpenWindow()) openWindow();
      else waitingForClick.current = true;
    }
    if (!waitingForClick.current) return;
    const onClick = () => {
      waitingForClick.current = false;
      openWindow();
    };
    window.addEventListener("click", onClick, { once: true, capture: true });
    return () =>
      window.removeEventListener("click", onClick, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the call opens
  }, []);

  // However the window closes (its close button, popping back in, the call ending), the call comes back
  useEffect(() => {
    if (!popout) return;
    const back = () => setPopout(null);
    const fs = () => setFullscreen(!!popout.document.fullscreenElement);
    popout.addEventListener("pagehide", back);
    popout.document.addEventListener("fullscreenchange", fs);
    const t = setInterval(() => popout.closed && back(), 500);
    return () => {
      clearInterval(t);
      popout.removeEventListener("pagehide", back);
      popout.document.removeEventListener("fullscreenchange", fs);
      popout.close();
    };
  }, [popout]);

  // Full screen for the call window, or for the expanded call in the app
  useEffect(() => {
    const fs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fs);
    return () => document.removeEventListener("fullscreenchange", fs);
  }, []);
  const toggleFullscreen = () => {
    const d = (popout ?? window).document;
    if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
    else d.documentElement.requestFullscreen().catch(() => {});
  };

  const toggleExpanded = () => {
    if (expanded && document.fullscreenElement)
      document.exitFullscreen().catch(() => {});
    setExpanded(!expanded);
  };

  const publish = (patch: Partial<State>) => {
    state.current = { ...state.current, ...patch };
    setMine(state.current);
    room.current?.track({ ...state.current, since: joinedAt.current, people: [...attendees.current] });
  };

  const setSlot = (slot: number, stream: MediaStream | null) => {
    const track = stream?.getVideoTracks()[0] ?? null;
    tracks.current[slot]?.stop();
    tracks.current[slot] = track;
    peers.current.forEach(({ pc }) => pc.getTransceivers()[slot]?.sender.replaceTrack(track).catch(() => {}));
    setLocal((l) => l.map((s, i) => (i === slot ? stream : s)));
  };

  const react = (emoji: string) => {
    setPicking(false);
    flash(setReactions, "me", emoji);
    room.current?.send({ type: "broadcast", event: "react", payload: { from: selfKey.current, emoji } });
  };

  const toggleMute = () => {
    const muted = !state.current.muted;
    const mic = tracks.current[MIC];
    if (mic) mic.enabled = !muted;
    publish({ muted });
  };

  const stopShare = () => {
    setSlot(SCREEN, null);
    publish({ sharing: false });
  };

  const share = async () => {
    if (tracks.current[SCREEN]) return stopShare();
    try {
      // Asked from the window that was clicked, since the browser requires a click there
      const s = await (popout ?? window).navigator.mediaDevices.getDisplayMedia(
        { video: { frameRate: { ideal: 15, max: 30 } }, audio: false },
      );
      const t = s.getVideoTracks()[0];
      t.contentHint = "detail";
      t.onended = stopShare;
      setSlot(SCREEN, s);
      publish({ sharing: true });
    } catch {}
  };

  const toggleCamera = async () => {
    if (tracks.current[CAMERA]) {
      setSlot(CAMERA, null);
      return publish({ camera: false });
    }
    try {
      setSlot(CAMERA, await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } }));
      publish({ camera: true });
    } catch {
      setError("Camera unavailable.");
    }
  };

  const people: Person[] = [
    { key: "me", user: me.id, state: mine, streams: local, self: true, reaction: reactions.me },
    ...Object.entries(present).map(([key, s]) => ({ key, user: key.split(":")[0], state: s, streams: remotes[key] ?? [], reaction: reactions[key] })),
  ];
  // Other people's screens come before your own
  const screens = people.filter((p) => p.state.sharing && p.streams[SCREEN]).sort((a, b) => Number(!!a.self) - Number(!!b.self));
  const main = screens.find((p) => p.key === focus) ?? screens[0];
  const othersSharing = screens.filter((p) => !p.self);
  const title = huddleName(channelId);
  const cols = people.length === 1 ? 1 : people.length <= 4 ? 2 : 3;
  const rows = Math.ceil(people.length / cols);
  const status = calling
    ? "Calling…"
    : unanswered && people.length === 1
      ? "No answer"
      : `${people.length} ${people.length === 1 ? "person" : "people"}`;

  const controls = (dark: boolean) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <Btn dark={dark} on={mine.muted} disabled={!local[MIC]} onClick={toggleMute} title={mine.muted ? "Unmute" : "Mute"}>
        <Icon name={mine.muted ? "micOff" : "mic"} />
      </Btn>
      <Btn dark={dark} on={mine.camera} onClick={toggleCamera} title={mine.camera ? "Turn off video" : "Turn on video"}>
        <Icon name={mine.camera ? "video" : "videoOff"} />
      </Btn>
      <Btn dark={dark} on={mine.sharing} onClick={share} title={mine.sharing ? "Stop sharing" : "Share screen"}>
        <Icon name={mine.sharing ? "monitorOff" : "monitorUp"} />
      </Btn>
      <Btn dark={dark} on={mine.hand} onClick={() => publish({ hand: !mine.hand })} title={mine.hand ? "Lower hand" : "Raise hand"}>
        <Icon name="hand" />
      </Btn>
      <div ref={picker} className="relative">
        <Btn dark={dark} on={picking} onClick={() => setPicking(!picking)} title="React">
          <Icon name="smile" />
        </Btn>
        {picking && (
          <div className={`tm-pop absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 gap-0.5 rounded-xl p-1 ${dark ? "bg-slate-800" : "tm-float bg-white"}`}>
            {REACTIONS.map((e) => (
              <button key={e} onClick={() => react(e)} title={`React ${e}`} className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition hover:scale-110 active:scale-95 ${dark ? "hover:bg-white/10" : "hover:bg-tm-surface"}`}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      <Btn dark={dark} onClick={() => setInviting(true)} title="Add people">
        <Icon name="userPlus" />
      </Btn>
      {!popout && (
        <Btn
          dark={dark}
          onClick={toggleExpanded}
          title={expanded ? "Minimize" : "Expand"}
        >
          <Icon name={expanded ? "minimize" : "maximize"} />
        </Btn>
      )}
      {(popout || expanded) && (
        <Btn
          dark={dark}
          on={fullscreen}
          onClick={toggleFullscreen}
          title={fullscreen ? "Exit full screen" : "Full screen"}
        >
          <Icon name={fullscreen ? "fullscreenExit" : "fullscreen"} />
        </Btn>
      )}
      <Btn danger onClick={onLeave} title={`Leave ${call}`}>
        <Icon name="phoneOff" size={16} />
        Leave
      </Btn>
    </div>
  );

  // The full call view: the call window shows it filling the window, the app shows it when expanded
  const stage = (inWindow: boolean) => (
    <div
      className={
        inWindow
          ? "flex h-full flex-col gap-3 bg-slate-950 p-3 text-white"
          : "tm-fade fixed inset-0 z-50 flex flex-col gap-3 bg-slate-950 p-4 text-white"
      }
    >
      <div className="flex items-center gap-2 px-1">
        <Icon
          name="headphones"
          size={inWindow ? 16 : 18}
          className="shrink-0 text-white/50"
        />
        <span
          className={`min-w-0 flex-1 truncate ${inWindow ? "text-sm" : ""}`}
        >
          <span className="font-semibold">{CALL}</span>
          <span className="text-white/60"> · {title}</span>
        </span>
        {huddleNotice && (
          <span className="truncate text-xs text-white/60">{huddleNotice}</span>
        )}
        <span
          className={`shrink-0 text-xs ${calling ? "tm-fade text-white/70" : "text-white/50"}`}
        >
          {status}
        </span>
      </div>
      {main ? (
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-black">
              <Video key={main.key} stream={main.streams[SCREEN]!} contain />
              <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1 text-xs">
                <Icon name="monitor" size={14} />
                {main.self
                  ? "Your screen"
                  : `${displayName(profiles[main.user])}'s screen`}
              </span>
            </div>
            {screens.length > 1 && (
              <div className="flex gap-2">
                {screens.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setFocus(p.key)}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition ${p === main ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"}`}
                  >
                    <Icon name="monitor" size={14} />
                    {p.self ? "You" : displayName(profiles[p.user])}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* A narrow call window gives the whole width to the screen */}
          <div
            className={`${inWindow ? "hidden w-44 sm:flex" : "flex w-56"} shrink-0 flex-col gap-2 overflow-y-auto`}
          >
            {people.map((p) => (
              <Tile key={p.key} p={p} profile={profiles[p.user]} small />
            ))}
          </div>
        </div>
      ) : inWindow ? (
        <div
          className="grid min-h-0 flex-1 gap-2"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {people.map((p) => (
            <Tile
              key={p.key}
              p={p}
              profile={profiles[p.user]}
              small={people.length > 2}
              fill
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
          <div
            className={`grid w-full gap-3 ${cols === 1 ? "max-w-2xl" : "max-w-5xl"}`}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {people.map((p) => (
              <Tile key={p.key} p={p} profile={profiles[p.user]} />
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-center text-xs text-amber-400">{error}</p>}
      <div className="flex justify-center">{controls(true)}</div>
    </div>
  );

  // The call's own window, Slack-huddle style: a calling screen until someone joins, then everyone's tiles
  const alone = people.length === 1;
  const dm = channels[channelId]?.kind === "dm";
  const callee = dm
    ? profiles[(dmMembers[channelId] ?? []).find((id) => id !== me.id) ?? ""]
    : undefined;
  const windowView = (
    // Framed in the app's colors: a green-to-blue header band and a green border round the window
    <div className="flex h-full flex-col border-[3px] border-tm-green bg-white text-zinc-900">
      <header className="flex items-center gap-2.5 bg-linear-to-r from-tm-green to-tm-blue px-3.5 py-2.5 text-white">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ring-2 ring-white/40 ${alone ? "bg-amber-300" : "bg-white"} ${calling ? "animate-pulse" : ""}`}
        />
        <Icon name="headphones" size={16} className="shrink-0 text-white/90" />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold">{title}</span>
          <span className="text-white/75"> · {CALL}</span>
        </span>
        {huddleNotice && (
          <span className="truncate text-xs text-white/85">{huddleNotice}</span>
        )}
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium text-white">
          {connectedAt && !alone ? (
            <>
              <Elapsed since={connectedAt} />
              <span className="text-white/50">·</span>
              <Icon name="users" size={12} />
              {people.length}
            </>
          ) : (
            status
          )}
        </span>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col gap-3 p-3"
        style={{
          background:
            "linear-gradient(180deg, #f0fdf4 0%, #ffffff 35%, #eff6ff 100%)",
        }}
      >
        {main ? (
          <div className="flex min-h-0 flex-1 gap-3">
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-zinc-900 ring-2 ring-tm-blue/30">
              <Video key={main.key} stream={main.streams[SCREEN]!} contain />
              <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur">
                <Icon name="monitor" size={13} />
                {main.self
                  ? "Your screen"
                  : `${displayName(profiles[main.user])}'s screen`}
              </span>
              {screens.length > 1 && (
                <div className="absolute top-2.5 right-2.5 flex gap-1.5">
                  {screens.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setFocus(p.key)}
                      className={`rounded-full px-2.5 py-1 text-xs transition ${p === main ? "bg-white text-slate-900" : "bg-black/60 text-white hover:bg-black/80"}`}
                    >
                      {p.self ? "You" : displayName(profiles[p.user])}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="hidden w-40 shrink-0 flex-col gap-2 overflow-y-auto sm:flex">
              {people.map((p) => (
                <div key={p.key} className="aspect-video shrink-0">
                  <WindowTile p={p} profile={profiles[p.user]} compact />
                </div>
              ))}
            </div>
          </div>
        ) : alone ? (
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-5 rounded-2xl">
            <div className="relative">
              {calling && (
                <span
                  className="absolute -inset-3 animate-ping rounded-[34%] bg-tm-green/25"
                  style={{ animationDuration: "1.8s" }}
                />
              )}
              {callee ? (
                <span className="relative block rounded-[30%] ring-4 ring-tm-green/40 ring-offset-4">
                  <Avatar profile={callee} size={104} />
                </span>
              ) : (
                <span className="relative flex h-[104px] w-[104px] items-center justify-center rounded-[30%] bg-tm-blue/10 ring-4 ring-tm-green/40 ring-offset-4">
                  <Icon name="headphones" size={44} className="text-tm-blue" />
                </span>
              )}
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">
                {callee ? displayName(callee) : title}
              </div>
              <div className="mt-1 text-sm text-zinc-500">
                {calling
                  ? "Calling…"
                  : unanswered
                    ? "No answer"
                    : "Waiting for others to join"}
              </div>
            </div>
            {/* Your camera, while there's no one else to show */}
            {mine.camera && local[CAMERA] && (
              <div className="absolute right-0 bottom-0 aspect-video w-36 overflow-hidden rounded-xl shadow-md ring-1 ring-zinc-200">
                <Video stream={local[CAMERA]!} mirror />
              </div>
            )}
          </div>
        ) : (
          <div
            className="grid min-h-0 flex-1 gap-2"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {people.map((p) => (
              <WindowTile
                key={p.key}
                p={p}
                profile={profiles[p.user]}
                compact={people.length > 2}
              />
            ))}
          </div>
        )}

        {error && <p className="text-center text-xs text-amber-600">{error}</p>}
        <div className="flex justify-center">
          <div className="rounded-2xl bg-white p-1.5 shadow-md ring-2 ring-tm-green/35">
            {controls(false)}
          </div>
        </div>
      </div>
    </div>
  );

  // The small box floating over the app
  const card = (
    <div
      ref={box}
      className={`tm-pop tm-float fixed z-40 w-[26rem] max-w-[calc(100vw-16px)] rounded-2xl bg-white p-3.5 ${pos ? "" : "bottom-4 left-4"}`}
      style={
        pos
          ? {
              left: `max(8px, min(${pos.x}px, calc(100vw - 424px)))`,
              top: `max(8px, min(${pos.y}px, calc(100vh - 190px)))`,
            }
          : undefined
      }
    >
      <div
        onPointerDown={startDrag}
        onDoubleClick={resetPos}
        className="-mx-1 -mt-1 flex cursor-grab touch-none items-center gap-2 rounded-xl px-1 py-1 select-none active:cursor-grabbing"
        title="Drag to move · drag off the edge to open it in its own window · double-click to reset"
      >
        <Icon name="grip" size={14} className="text-zinc-300" />
        <Icon name="headphones" size={18} className="text-zinc-500" />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold">{CALL}</span>
          <span className="text-zinc-500"> · {title}</span>
        </span>
        <span className="text-xs text-zinc-400">{people.length}</span>
      </div>
      <div className="my-3.5 flex flex-wrap items-center gap-3">
        {people.map((p) => (
          <Face key={p.key} p={p} profile={profiles[p.user]} />
        ))}
        {calling && (
          <span className="tm-fade ml-1 text-xs text-zinc-400">Calling…</span>
        )}
        {unanswered && people.length === 1 && (
          <span className="ml-1 text-xs text-zinc-400">No answer</span>
        )}
      </div>
      {othersSharing.length > 0 && (
        <button
          onClick={toggleExpanded}
          className="mb-2 flex w-full items-center gap-2 rounded-xl border border-tm-line px-3 py-1.5 text-left text-xs text-zinc-600 transition hover:bg-tm-surface"
        >
          <Icon name="monitor" size={14} />
          {othersSharing
            .map((p) => displayName(profiles[p.user]))
            .join(", ")}{" "}
          {othersSharing.length > 1 ? "are" : "is"} sharing · View
        </button>
      )}
      {mine.sharing && (
        <p className="mb-2 text-xs text-zinc-500">
          You are sharing your screen
        </p>
      )}
      {error && <p className="mb-2 text-xs text-amber-600">{error}</p>}
      {huddleNotice && (
        <p className="mb-2 text-xs text-zinc-500">{huddleNotice}</p>
      )}
      {controls(false)}
    </div>
  );

  return (
    <>
      {/* Voices play from the app's page either way, so they keep going whatever the call window does */}
      {Object.entries(remotes).map(([k, s]) => s[MIC] && <Sound key={k} stream={s[MIC]} />)}

      {popout
        ? createPortal(windowView, popout.document.body)
        : expanded
          ? stage(false)
          : card}

      {inviting && <InvitePeople inHuddle={people.map((p) => p.user)} onClose={() => setInviting(false)} />}
    </>
  );
}

// Shown in the other tabs while a call runs in one of them: the call has one connection per browser
export function HuddleElsewhere() {
  const { huddle, huddleElsewhere, huddleName, takeHuddleHere, leaveHuddleElsewhere } = useChat();
  if (huddle || !huddleElsewhere) return null;
  return (
    <div className="tm-pop tm-float fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-32px)] items-center gap-2 rounded-2xl bg-white py-2 pr-2 pl-3">
      <Icon name="headphones" size={18} className="shrink-0 text-tm-green" />
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-semibold">{CALL}</span>
        <span className="text-zinc-500"> · {huddleName(huddleElsewhere)} · in another tab</span>
      </span>
      <Btn onClick={takeHuddleHere} title="Move the call to this tab">
        <Icon name="popIn" />
        <span className="pr-1.5">Move here</span>
      </Btn>
      <Btn danger onClick={leaveHuddleElsewhere} title={`Leave ${call}`}>
        <Icon name="phoneOff" size={16} />
      </Btn>
    </div>
  );
}

function InvitePeople({ inHuddle, onClose }: { inHuddle: string[]; onClose: () => void }) {
  const { me, profiles, online, ringing, inviteToHuddle } = useChat();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = Object.values(profiles)
    .filter((p) => p.id !== me.id && !inHuddle.includes(p.id) && `${displayName(p)} ${p.username}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || displayName(a).localeCompare(displayName(b)));
  return (
    <Modal title={`Add people to the ${call}`} onClose={onClose}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className={input} />
      <div className="mt-3 max-h-80 space-y-0.5 overflow-y-auto">
        {list.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-tm-surface">
            <Avatar profile={p} size={32} online={online.has(p.id)} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{displayName(p)}</div>
              <div className="truncate text-xs text-zinc-400">@{p.username}</div>
            </div>
            <button
              disabled={ringing.has(p.id)}
              onClick={() => inviteToHuddle([p.id])}
              className="rounded-xl bg-tm-green px-3 py-1 text-sm font-semibold text-white transition hover:brightness-95 disabled:bg-zinc-200 disabled:text-zinc-500"
            >
              {ringing.has(p.id) ? "Ringing…" : "Invite"}
            </button>
          </div>
        ))}
        {list.length === 0 && <p className="py-6 text-center text-sm text-zinc-400">No one else to add</p>}
      </div>
    </Modal>
  );
}

// Incoming call: rings until answered, declined, 30 seconds pass, or the huddle empties.
// A scheduled meeting rings the same way, but keeps ringing while no one has joined yet.
export function IncomingHuddle() {
  const { me, ring, profiles, huddles, channels, huddleName, setHuddle, setActive, dismissRing } = useChat();
  const silent = inDnd(me);
  const live = !!ring && (!!ring.meeting || !!huddles[ring.channelId]?.length);

  const flashText = ring ? (ring.meeting ? `📅 ${ring.title} is starting…` : `📞 ${displayName(profiles[ring.from])} is calling…`) : "";
  useEffect(() => {
    if (!ring) return;
    if (!silent) ringtone();
    const sound = silent ? undefined : setInterval(ringtone, 2500);
    const expire = setTimeout(() => dismissRing(), 30_000);
    // Flash the tab title so the call is noticed from another tab
    const title = document.title;
    let flip = false;
    const flash = setInterval(() => (document.title = (flip = !flip) ? flashText : title), 1000);
    return () => {
      clearInterval(sound);
      clearInterval(flash);
      clearTimeout(expire);
      document.title = title;
    };
  }, [ring, silent, dismissRing, flashText]);

  // Once the call has been seen running, it emptying means the caller left: stop ringing at once.
  // Before that, give presence a moment to catch up with the ring.
  const seenLive = useRef<Ring | null>(null);
  useEffect(() => {
    if (!ring) return;
    if (live) {
      seenLive.current = ring;
      return;
    }
    const t = setTimeout(() => dismissRing(), seenLive.current === ring ? 0 : 5000);
    return () => clearTimeout(t);
  }, [ring, live, dismissRing]);

  if (!ring) return null;
  const caller = profiles[ring.from];
  const others = (huddles[ring.channelId] ?? []).filter((id) => id !== ring.from);
  const join = () => {
    setHuddle(ring.channelId);
    if (channels[ring.channelId]) setActive(ring.channelId);
  };

  // A DM call is "calling you"; a channel call names the channel; a meeting names itself
  const direct = channels[ring.channelId]?.kind === "dm";
  const withOthers = others.length > 0 ? ` with ${others.length} other${others.length > 1 ? "s" : ""}` : "";
  const joined = huddles[ring.channelId]?.length ?? 0;

  return (
    <div className="tm-fade fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-label={ring.meeting ? `${ring.title} is starting` : `${displayName(caller)} is calling you`}
        className="tm-pop tm-float flex w-full max-w-sm flex-col items-center rounded-3xl bg-white px-8 pt-10 pb-8 text-center"
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          <Icon name={ring.meeting ? "calendar" : "headphones"} size={14} />
          {ring.meeting ? `Scheduled ${call} starting` : `Incoming ${call}`}
        </div>
        <div className="mt-6 rounded-[30%] ring-4 ring-tm-line ring-offset-4">
          <Avatar profile={caller} size={88} />
        </div>
        <div className="mt-6 w-full truncate text-xl font-semibold text-zinc-900">{ring.meeting ? ring.title : displayName(caller)}</div>
        <div className="mt-1 w-full truncate text-sm text-zinc-500">
          {ring.meeting ? (
            <>
              {direct ? "Organized by" : <>In <span className="font-medium text-zinc-700">{huddleName(ring.channelId)}</span> · by</>} {ring.from === me.id ? "you" : displayName(caller)}
              {joined > 0 && ` · ${joined} joined`}
            </>
          ) : direct ? (
            `is calling you${withOthers}`
          ) : (
            <>{CALL} in <span className="font-medium text-zinc-700">{huddleName(ring.channelId)}</span>{withOthers}</>
          )}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-zinc-400">
          <span className="inline-flex gap-0.5">
            <span className="tm-dot">●</span>
            <span className="tm-dot" style={{ animationDelay: "0.15s" }}>●</span>
            <span className="tm-dot" style={{ animationDelay: "0.3s" }}>●</span>
          </span>
          {silent ? "Ringing silently · notifications paused" : "Ringing"}
        </div>
        <div className="mt-8 grid w-full grid-cols-2 gap-3">
          <button onClick={() => dismissRing(true)} className="flex items-center justify-center gap-2 rounded-xl border border-tm-line py-3 text-sm font-medium text-zinc-700 transition hover:bg-tm-surface active:scale-[0.98]">
            <Icon name="phoneOff" size={18} />
            Decline
          </button>
          <button onClick={join} autoFocus className="flex items-center justify-center gap-2 rounded-xl bg-tm-blue py-3 text-sm font-semibold text-white transition hover:bg-tm-blue-dark active:scale-[0.98]">
            <Icon name="headphones" size={18} />
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
