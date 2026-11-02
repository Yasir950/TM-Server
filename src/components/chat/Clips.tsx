"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clock } from "@/lib/format";
import { Icon } from "../icons";
import { Modal, btn, btnGhost } from "../ui";

// Voice and video clips: recorded in the browser with MediaRecorder and sent as ordinary attachments

export const MAX_CLIP_SECONDS = 300;

// Recorded File -> its length and waveform; the composer copies these onto the attachment when it uploads
export const clipMeta = new WeakMap<File, { duration: number; peaks?: number[] }>();

const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const VIDEO_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];

function getMedia(c: MediaStreamConstraints) {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error("Recording needs a secure (https) connection."));
  return navigator.mediaDevices.getUserMedia(c);
}

function mediaError(e: unknown) {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Access was blocked. Allow the camera/microphone for this site in your browser and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera or microphone was found.";
  if (name === "NotReadableError") return "Your camera or microphone is in use by another app.";
  return (e as Error)?.message || "Recording isn't available in this browser.";
}

// Chrome writes WebM without a duration; seeking to the end once makes the length known and the clip seekable
export function fixDuration(el: HTMLMediaElement) {
  if (el.duration !== Infinity) return;
  el.currentTime = 1e101;
  el.addEventListener("timeupdate", () => (el.currentTime = 0), { once: true });
}

// Loudest level per bucket, scaled to 0-1
function downsample(levels: number[], n: number) {
  if (!levels.length) return [];
  const out = Array.from({ length: n }, (_, i) => {
    const a = Math.floor((i * levels.length) / n);
    return Math.max(...levels.slice(a, Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n))));
  });
  const max = Math.max(...out) || 1;
  return out.map((v) => Math.round(Math.max(0.06, v / max) * 100) / 100);
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

type Recording = { mr: MediaRecorder; timer: number; keep: boolean; started: number; duration: number; ctx?: AudioContext };

function useClipRecorder(kind: "audio" | "video", onDone: (f: File) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const done = useRef(onDone);
  const cur = useRef<Recording | null>(null);
  useEffect(() => {
    done.current = onDone;
  });

  const finish = useCallback((keep: boolean) => {
    const r = cur.current;
    if (!r) return;
    cur.current = null;
    r.keep = keep;
    r.duration = (performance.now() - r.started) / 1000;
    clearInterval(r.timer);
    r.ctx?.close();
    if (r.mr.state !== "inactive") r.mr.stop();
    setRecording(false);
  }, []);

  const start = useCallback(
    (stream: MediaStream) => {
      const mimeType = (kind === "audio" ? AUDIO_TYPES : VIDEO_TYPES).find((t) => MediaRecorder.isTypeSupported(t));
      const mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000, ...(kind === "video" && { videoBitsPerSecond: 1_000_000 }) });
      const r: Recording = { mr, timer: 0, keep: true, started: performance.now(), duration: 0 };
      const chunks: Blob[] = [];
      const peaks: number[] = [];

      let sample: (() => number) | undefined;
      if (kind === "audio") {
        const ctx = (r.ctx = new AudioContext());
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        sample = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          return Math.sqrt(sum / buf.length);
        };
      }

      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      mr.onstop = () => {
        if (!r.keep || !chunks.length) return;
        const type = (mr.mimeType || mimeType || `${kind}/webm`).split(";")[0];
        const ext = type.endsWith("mp4") ? (kind === "audio" ? "m4a" : "mp4") : type.split("/")[1];
        const file = new File(chunks, `${kind === "audio" ? "voice" : "video"}-clip-${stamp()}.${ext}`, { type });
        clipMeta.set(file, { duration: Math.round(r.duration * 10) / 10, peaks: sample && downsample(peaks, 48) });
        done.current(file);
      };

      r.timer = window.setInterval(() => {
        const s = (performance.now() - r.started) / 1000;
        setElapsed(s);
        if (sample) {
          const v = sample();
          peaks.push(v);
          setLevels((l) => [...l.slice(-39), v]);
        }
        if (s >= MAX_CLIP_SECONDS) finish(true);
      }, 100);
      mr.start(1000);
      cur.current = r;
      setElapsed(0);
      setLevels([]);
      setRecording(true);
    },
    [kind, finish],
  );

  useEffect(() => () => finish(false), [finish]);
  return { recording, elapsed, levels, start, stop: () => finish(true), cancel: () => finish(false) };
}

const roundBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95";

// Takes over the composer while recording; hands back an audio File when stopped
export function VoiceRecorder({ onDone, onCancel }: { onDone: (f: File) => void; onCancel: () => void }) {
  const [error, setError] = useState("");
  const rec = useClipRecorder("audio", onDone);
  const { start, cancel } = rec;

  useEffect(() => {
    let live = true;
    let stream: MediaStream | undefined;
    getMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => {
        stream = s;
        if (live) start(s);
        else s.getTracks().forEach((t) => t.stop());
      })
      .catch((e) => live && setError(mediaError(e)));
    return () => {
      live = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [start]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      cancel();
      onCancel();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [cancel, onCancel]);

  if (error)
    return (
      <div className="flex items-center gap-3 px-3 py-3 text-sm">
        <Icon name="micOff" className="text-red-500" />
        <span className="flex-1 text-zinc-600">{error}</span>
        <button onClick={onCancel} className="rounded-lg px-2.5 py-1 text-zinc-500 transition hover:bg-tm-surface">
          Dismiss
        </button>
      </div>
    );

  return (
    <div className="tm-fade flex items-center gap-3 px-3 py-2.5">
      <button
        type="button"
        title="Discard (Esc)"
        onClick={() => {
          cancel();
          onCancel();
        }}
        className={`${roundBtn} text-zinc-400 hover:bg-red-50 hover:text-red-600`}
      >
        <Icon name="trash" size={16} />
      </button>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 ${rec.recording ? "animate-pulse" : "opacity-30"}`} />
      <span className="w-10 font-mono text-sm text-zinc-700 tabular-nums">{clock(rec.elapsed)}</span>
      <div className="flex h-8 flex-1 items-center justify-end gap-[3px] overflow-hidden">
        {rec.levels.map((v, i) => (
          <span key={i} className="w-[3px] shrink-0 rounded-full bg-tm-blue transition-[height] duration-100" style={{ height: `${Math.max(10, Math.min(100, v * 400))}%` }} />
        ))}
      </div>
      <span className="hidden text-xs text-zinc-400 sm:inline">{rec.recording ? `max ${clock(MAX_CLIP_SECONDS)}` : "Starting microphone…"}</span>
      <button type="button" title="Finish recording" disabled={!rec.recording} onClick={rec.stop} className={`${roundBtn} bg-tm-green text-white hover:brightness-105 disabled:opacity-40`}>
        <Icon name="check" size={16} />
      </button>
    </div>
  );
}

type Source = "camera" | "screen";

async function openStream(src: Source) {
  if (src === "camera") {
    const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
    return getMedia({ video, audio: true }).catch((e) => getMedia({ video }).catch(() => Promise.reject(e)));
  }
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen recording isn't supported in this browser.");
  const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
  // Narrate over the screen with the microphone when there is one
  const mic = await getMedia({ audio: true }).catch(() => null);
  if (!mic) return screen;
  screen.getAudioTracks().forEach((t) => t.stop());
  return new MediaStream([...screen.getVideoTracks(), ...mic.getAudioTracks()]);
}

export function VideoRecorder({ onDone, onClose }: { onDone: (f: File) => void; onClose: () => void }) {
  const [source, setSource] = useState<Source>("camera");
  const [preview, setPreview] = useState<{ stream: MediaStream; source: Source } | null>(null);
  const [clip, setClip] = useState<File | null>(null);
  const [error, setError] = useState("");
  const onEnded = useRef(() => {});
  const rec = useClipRecorder("video", setClip);
  const switchTo = useCallback((s: Source) => {
    setPreview(null);
    setSource(s);
  }, []);

  useEffect(() => {
    // The browser's own "Stop sharing" button ends the clip (or drops back to the camera)
    onEnded.current = () => (rec.recording ? rec.stop() : switchTo("camera"));
  });

  // A live preview while choosing or recording; switching source, finishing a clip or closing releases the device
  useEffect(() => {
    if (clip) return;
    let live = true;
    let stream: MediaStream | undefined;
    openStream(source).then(
      (s) => {
        stream = s;
        if (!live) return s.getTracks().forEach((t) => t.stop());
        s.getVideoTracks()[0]?.addEventListener("ended", () => live && onEnded.current());
        setError("");
        setPreview({ stream: s, source });
      },
      (e) => {
        if (!live) return;
        // Closing the screen picker isn't an error; go back to the camera
        if (source === "screen" && (e as DOMException)?.name === "NotAllowedError") switchTo("camera");
        else setError(mediaError(e));
      },
    );
    return () => {
      live = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [source, clip, switchTo]);

  const clipUrl = useMemo(() => (clip ? URL.createObjectURL(clip) : null), [clip]);
  useEffect(
    () => () => {
      if (clipUrl) URL.revokeObjectURL(clipUrl);
    },
    [clipUrl],
  );

  const stream = !clip && preview?.source === source ? preview.stream : null;
  const close = () => {
    rec.cancel();
    onClose();
  };

  return (
    <Modal title="Record a video clip" onClose={close} wide>
      <div className="mb-3 flex gap-1 rounded-xl bg-tm-surface p-1">
        {(
          [
            ["camera", "camera", "Camera"],
            ["screen", "monitorUp", "Screen"],
          ] as const
        ).map(([id, icon, label]) => (
          <button
            key={id}
            disabled={rec.recording || !!clip}
            onClick={() => id !== source && switchTo(id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${source === id ? "tm-raised bg-white text-tm-blue" : "text-zinc-500 hover:text-zinc-800"}`}
          >
            <Icon name={icon} size={16} /> {label}
          </button>
        ))}
      </div>

      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-slate-950">
        {clipUrl ? (
          <video key={clipUrl} src={clipUrl} controls autoPlay playsInline onLoadedMetadata={(e) => fixDuration(e.currentTarget)} className="h-full w-full object-contain" />
        ) : stream ? (
          <video
            ref={(el) => {
              if (el && el.srcObject !== stream) el.srcObject = stream;
            }}
            autoPlay
            muted
            playsInline
            className={`h-full w-full object-contain ${source === "camera" ? "-scale-x-100" : ""}`}
          />
        ) : (
          <p className="max-w-sm px-6 text-center text-sm text-white/70">{error || (source === "screen" ? "Choose a screen to share…" : "Starting camera…")}</p>
        )}
        {rec.recording && (
          <span className="tm-pop absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 font-mono text-sm text-white tabular-nums">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            {clock(rec.elapsed)} / {clock(MAX_CLIP_SECONDS)}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {clip ? (
          <>
            <span className="mr-auto text-sm text-zinc-500">Ready to attach</span>
            <button
              className={btnGhost}
              onClick={() => {
                setPreview(null);
                setClip(null);
              }}
            >
              Retake
            </button>
            <button
              className={btn}
              onClick={() => {
                onDone(clip);
                onClose();
              }}
            >
              Attach clip
            </button>
          </>
        ) : rec.recording ? (
          <>
            <button className={btnGhost} onClick={close}>
              Discard
            </button>
            <button className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 active:scale-[0.98]" onClick={rec.stop}>
              <Icon name="stop" size={14} filled /> Stop recording
            </button>
          </>
        ) : (
          <>
            <span className="mr-auto text-xs text-zinc-400">Clips can be up to {MAX_CLIP_SECONDS / 60} minutes long.</span>
            <button
              disabled={!stream}
              onClick={() => stream && rec.start(stream)}
              className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 active:scale-[0.98] disabled:opacity-50"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-white" /> Start recording
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

// Placeholder waveform for audio uploaded as a file rather than recorded here
const FLAT = Array.from({ length: 48 }, (_, i) => 0.3 + 0.25 * Math.abs(Math.sin(i * 1.7)));

export function AudioPlayer({ src, duration = 0, peaks }: { src: string; duration?: number; peaks?: number[] }) {
  const el = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(duration);
  const [rate, setRate] = useState(1);
  const bars = peaks?.length ? peaks : FLAT;
  const progress = dur ? Math.min(1, time / dur) : 0;

  return (
    <div className="flex w-80 max-w-full items-center gap-3 rounded-xl border border-tm-line bg-white px-2.5 py-2">
      <audio
        ref={el}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => fixDuration(e.currentTarget)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
      />
      <button
        type="button"
        title={playing ? "Pause" : "Play"}
        onClick={() => (el.current!.paused ? el.current!.play() : el.current!.pause())}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tm-blue text-white transition hover:bg-tm-blue-dark active:scale-95"
      >
        <Icon name={playing ? "pause" : "play"} size={15} filled />
      </button>
      <div
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(time)}
        tabIndex={0}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (dur) el.current!.currentTime = ((e.clientX - r.left) / r.width) * dur;
        }}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px]"
      >
        {bars.map((v, i) => (
          <span key={i} className={`min-w-px flex-1 rounded-full transition-colors ${i / bars.length < progress ? "bg-tm-blue" : "bg-zinc-300"}`} style={{ height: `${Math.max(12, v * 100)}%` }} />
        ))}
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-xs text-zinc-500 tabular-nums">{clock(playing || time ? time : dur)}</span>
      <button
        type="button"
        title="Playback speed"
        onClick={() => {
          const r = rate >= 2 ? 1 : rate + 0.5;
          setRate(r);
          el.current!.playbackRate = r;
        }}
        className="w-9 shrink-0 rounded-md py-0.5 text-xs font-semibold text-zinc-500 transition hover:bg-tm-surface"
      >
        {rate}×
      </button>
    </div>
  );
}
