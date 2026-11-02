"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, displayName, inDnd, type Profile } from "@/lib/supabase";
import { CALL, call } from "@/lib/brand";
import { Avatar, Modal, input } from "../ui";
import { Icon } from "../icons";
import { useChat } from "./store";

// Mesh WebRTC: every participant connects to every other; Supabase Realtime carries the signaling.
// People behind strict NATs or firewalls can only connect through a TURN relay (NEXT_PUBLIC_TURN_*).
const turn = process.env.NEXT_PUBLIC_TURN_URL;
const ICE: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ...(turn ? [{ urls: turn.split(","), username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL }] : []),
];

// Every connection carries three fixed slots. Muting, sharing or turning on the camera swaps a
// track in or out with replaceTrack, so a call is negotiated once and never mid-call.
const SLOTS = ["audio", "video", "video"] as const;
const MIC = 0;
const SCREEN = 1;
const CAMERA = 2;

type State = { muted: boolean; sharing: boolean; camera: boolean };
type Signal = { from: string; to: string; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
type Peer = { pc: RTCPeerConnection; chain: Promise<void> };
type Person = { key: string; user: string; state: State; streams: (MediaStream | null | undefined)[]; self?: boolean };

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
    <span className={`relative rounded-[30%] ring-2 ring-offset-1 transition ${speaking ? "ring-tm-green" : "ring-transparent"}`} title={displayName(profile)}>
      <Avatar profile={profile} size={30} />
      {p.state.muted && (
        <span className="absolute -right-1.5 -bottom-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-tm-line bg-white text-zinc-600">
          <Icon name="micOff" size={8} />
        </span>
      )}
      {p.state.sharing && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-tm-line bg-white text-zinc-600">
          <Icon name="monitor" size={8} />
        </span>
      )}
    </span>
  );
}

function Tile({ p, profile, small }: { p: Person; profile?: Profile; small?: boolean }) {
  const speaking = useSpeaking(p.streams[MIC], !p.state.muted);
  const cam = p.state.camera ? p.streams[CAMERA] : null;
  return (
    <div className={`relative flex aspect-video shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-800 ring-2 transition ${speaking ? "ring-tm-green" : "ring-transparent"}`}>
      {cam ? <Video stream={cam} mirror={p.self} /> : <Avatar profile={profile} size={small ? 44 : 80} />}
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
    ? "bg-red-500 px-3 font-semibold text-white hover:bg-red-600"
    : on
      ? dark ? "bg-white text-slate-900" : "bg-zinc-800 text-white"
      : dark ? "bg-white/10 hover:bg-white/20" : "border border-tm-line text-zinc-600 hover:bg-tm-surface";
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={title} className={`flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-xl text-sm transition active:scale-95 disabled:opacity-40 ${tone}`}>
      {children}
    </button>
  );
}

export default function Huddle({ channelId, onLeave }: { channelId: string; onLeave: () => void }) {
  const { me, profiles, channels, huddleName, huddleNotice } = useChat();
  const [present, setPresent] = useState<Record<string, State>>({});
  const [remotes, setRemotes] = useState<Record<string, MediaStream[]>>({});
  const [mine, setMine] = useState<State>({ muted: false, sharing: false, camera: false });
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

  useEffect(() => {
    let closed = false;
    const self = `${me.id}:${tab}${++joins}`;
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

    const connect = (key: string) => {
      const pc = new RTCPeerConnection({ iceServers: ICE });
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
    let seen = new Set<string>();
    (async () => {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (closed) return mic.getTracks().forEach((t) => t.stop());
        sending[MIC] = mic.getAudioTracks()[0];
        setLocal((l) => [mic, l[SCREEN], l[CAMERA]]);
      } catch {
        setError("Microphone unavailable. You can still listen and share your screen.");
      }
      if (closed) return;
      ch.on("presence", { event: "sync" }, () => {
        const others: Record<string, State> = {};
        for (const [key, [m]] of Object.entries(ch.presenceState<State>()))
          if (key !== self) others[key] = { muted: !!m?.muted, sharing: !!m?.sharing, camera: !!m?.camera };
        setPresent(others);
        const keys = Object.keys(others);
        if (keys.some((k) => !seen.has(k))) joinSound();
        else if ([...seen].some((k) => !others[k])) leaveSound();
        seen = new Set(keys);
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
        .on("presence", { event: "leave" }, ({ key }) => drop(key))
        .on("broadcast", { event: "signal" }, ({ payload }) => onSignal(payload as Signal))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") ch.track(state.current);
        });
    })();

    return () => {
      closed = true;
      conns.forEach((p) => p.pc.close());
      conns.clear();
      sending.forEach((t) => t?.stop());
      sending.fill(null);
      room.current = null;
      supabase.removeChannel(ch);
    };
  }, [channelId, me.id]);

  // Calling someone in a DM: ringback until they pick up, for up to 30 seconds
  const calling = channels[channelId]?.kind === "dm" && Object.keys(present).length === 0 && !unanswered;
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

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || !box.current) return;
    e.preventDefault();
    const rect = box.current.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    let last: { x: number; y: number } | null = null;
    const move = (ev: PointerEvent) => {
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

  const publish = (patch: Partial<State>) => {
    state.current = { ...state.current, ...patch };
    setMine(state.current);
    room.current?.track(state.current);
  };

  const setSlot = (slot: number, stream: MediaStream | null) => {
    const track = stream?.getVideoTracks()[0] ?? null;
    tracks.current[slot]?.stop();
    tracks.current[slot] = track;
    peers.current.forEach(({ pc }) => pc.getTransceivers()[slot]?.sender.replaceTrack(track).catch(() => {}));
    setLocal((l) => l.map((s, i) => (i === slot ? stream : s)));
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
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
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
    { key: "me", user: me.id, state: mine, streams: local, self: true },
    ...Object.entries(present).map(([key, s]) => ({ key, user: key.split(":")[0], state: s, streams: remotes[key] ?? [] })),
  ];
  // Other people's screens come before your own
  const screens = people.filter((p) => p.state.sharing && p.streams[SCREEN]).sort((a, b) => Number(!!a.self) - Number(!!b.self));
  const main = screens.find((p) => p.key === focus) ?? screens[0];
  const othersSharing = screens.filter((p) => !p.self);
  const title = huddleName(channelId);
  const cols = people.length === 1 ? 1 : people.length <= 4 ? 2 : 3;

  const controls = (dark: boolean) => (
    <div className="flex items-center gap-1.5">
      <Btn dark={dark} on={mine.muted} disabled={!local[MIC]} onClick={toggleMute} title={mine.muted ? "Unmute" : "Mute"}>
        <Icon name={mine.muted ? "micOff" : "mic"} />
      </Btn>
      <Btn dark={dark} on={mine.camera} onClick={toggleCamera} title={mine.camera ? "Turn off video" : "Turn on video"}>
        <Icon name={mine.camera ? "video" : "videoOff"} />
      </Btn>
      <Btn dark={dark} on={mine.sharing} onClick={share} title={mine.sharing ? "Stop sharing" : "Share screen"}>
        <Icon name={mine.sharing ? "monitorOff" : "monitorUp"} />
      </Btn>
      <Btn dark={dark} onClick={() => setInviting(true)} title="Add people">
        <Icon name="userPlus" />
      </Btn>
      <Btn dark={dark} onClick={() => setExpanded(!expanded)} title={expanded ? "Minimize" : "Expand"}>
        <Icon name={expanded ? "minimize" : "maximize"} />
      </Btn>
      <Btn danger onClick={onLeave} title={`Leave ${call}`}>
        <Icon name="phoneOff" size={16} />
        Leave
      </Btn>
    </div>
  );

  return (
    <>
      {Object.entries(remotes).map(([k, s]) => s[MIC] && <Sound key={k} stream={s[MIC]} />)}

      {expanded ? (
        <div className="tm-fade fixed inset-0 z-50 flex flex-col gap-3 bg-slate-950 p-4 text-white">
          <div className="flex items-center gap-2">
            <Icon name="headphones" size={18} className="text-zinc-500" />
            <span className="flex-1 truncate font-semibold">
              {CALL} · {title}
            </span>
            {huddleNotice && <span className="text-sm text-white/60">{huddleNotice}</span>}
            <span className="text-sm text-white/50">
              {people.length} {people.length === 1 ? "person" : "people"}
            </span>
          </div>
          {main ? (
            <div className="flex min-h-0 flex-1 gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-black">
                  <Video key={main.key} stream={main.streams[SCREEN]!} contain />
                  <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1 text-xs">
                    <Icon name="monitor" size={14} />
                    {main.self ? "Your screen" : `${displayName(profiles[main.user])}'s screen`}
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
              <div className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto">
                {people.map((p) => (
                  <Tile key={p.key} p={p} profile={profiles[p.user]} small />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
              <div className={`grid w-full gap-3 ${cols === 1 ? "max-w-2xl" : "max-w-5xl"}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {people.map((p) => (
                  <Tile key={p.key} p={p} profile={profiles[p.user]} />
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-center text-xs text-amber-400">{error}</p>}
          <div className="flex justify-center">{controls(true)}</div>
        </div>
      ) : (
        <div
          ref={box}
          className={`tm-pop tm-float fixed z-40 w-80 rounded-2xl bg-white p-3 ${pos ? "" : "bottom-4 left-4"}`}
          style={pos ? { left: `max(8px, min(${pos.x}px, calc(100vw - 328px)))`, top: `max(8px, min(${pos.y}px, calc(100vh - 160px)))` } : undefined}
        >
          <div
            onPointerDown={startDrag}
            onDoubleClick={resetPos}
            className="-mx-1 -mt-1 flex cursor-grab touch-none items-center gap-2 rounded-xl px-1 py-1 select-none active:cursor-grabbing"
            title="Drag to move · double-click to reset"
          >
            <Icon name="grip" size={14} className="text-zinc-300" />
            <Icon name="headphones" size={18} className="text-zinc-500" />
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-semibold">{CALL}</span>
              <span className="text-zinc-500"> · {title}</span>
            </span>
            <span className="text-xs text-zinc-400">{people.length}</span>
          </div>
          <div className="my-2.5 flex flex-wrap items-center gap-2">
            {people.map((p) => (
              <Face key={p.key} p={p} profile={profiles[p.user]} />
            ))}
            {calling && <span className="tm-fade ml-1 text-xs text-zinc-400">Calling…</span>}
            {unanswered && people.length === 1 && <span className="ml-1 text-xs text-zinc-400">No answer</span>}
          </div>
          {othersSharing.length > 0 && (
            <button onClick={() => setExpanded(true)} className="mb-2 flex w-full items-center gap-2 rounded-xl border border-tm-line px-3 py-1.5 text-left text-xs text-zinc-600 transition hover:bg-tm-surface">
              <Icon name="monitor" size={14} />
              {othersSharing.map((p) => displayName(profiles[p.user])).join(", ")} {othersSharing.length > 1 ? "are" : "is"} sharing · View
            </button>
          )}
          {mine.sharing && <p className="mb-2 text-xs text-zinc-500">You are sharing your screen</p>}
          {error && <p className="mb-2 text-xs text-amber-600">{error}</p>}
          {huddleNotice && <p className="mb-2 text-xs text-zinc-500">{huddleNotice}</p>}
          {controls(false)}
        </div>
      )}

      {inviting && <InvitePeople inHuddle={people.map((p) => p.user)} onClose={() => setInviting(false)} />}
    </>
  );
}

function InvitePeople({ inHuddle, onClose }: { inHuddle: string[]; onClose: () => void }) {
  const { me, profiles, online, inviteToHuddle } = useChat();
  const [q, setQ] = useState("");
  const [rung, setRung] = useState<Set<string>>(new Set());
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
              disabled={rung.has(p.id)}
              onClick={() => {
                inviteToHuddle([p.id]);
                setRung(new Set(rung).add(p.id));
              }}
              className="rounded-xl bg-tm-green px-3 py-1 text-sm font-semibold text-white transition hover:brightness-95 disabled:bg-zinc-200 disabled:text-zinc-500"
            >
              {rung.has(p.id) ? "Ringing…" : "Invite"}
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

  useEffect(() => {
    if (!ring || live) return;
    const t = setTimeout(() => dismissRing(), 5000);
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
