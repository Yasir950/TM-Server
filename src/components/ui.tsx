"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { supabase, displayName, activeStatus, type Profile } from "@/lib/supabase";
import { APP_NAME } from "@/lib/brand";

const palette = ["#1c75bc", "#39b54a", "#155a91", "#2d8a3a", "#4a90c9", "#5cb85c"];

export function Avatar({ profile, size = 36, online, away }: { profile?: Profile; size?: number; online?: boolean; away?: boolean }) {
  const name = displayName(profile);
  const color = palette[(profile?.id.charCodeAt(0) ?? 0) % palette.length];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {profile?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatar_url} alt="" className="h-full w-full rounded-[30%] object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-[30%] font-semibold text-white"
          style={{ background: color, fontSize: size * 0.42 }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      {online !== undefined && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white transition-colors ${
            online && !away ? "bg-tm-green" : online ? "bg-amber-400" : "bg-zinc-300"
          }`}
        />
      )}
    </div>
  );
}

// A person's custom status: the emoji (text on hover), or emoji + text when there's room
export function StatusBadge({ profile, withText }: { profile?: Profile; withText?: boolean }) {
  const s = activeStatus(profile);
  if (!s) return null;
  return (
    <span title={s.text} className="inline-flex min-w-0 shrink items-center gap-1">
      <span className="shrink-0">{s.emoji || "💬"}</span>
      {withText && s.text && <span className="truncate text-sm font-normal text-zinc-500">{s.text}</span>}
    </span>
  );
}

// App mark plus wordmark, scaled by height
export function Logo({ height = 40 }: { height?: number }) {
  return (
    <span className="inline-flex items-center select-none" style={{ height, gap: height * 0.28 }}>
      <Mark size={height * 0.86} className="rounded-[25%] shadow-sm" />
      <span className="font-semibold tracking-[-0.02em] text-zinc-900" style={{ fontSize: height * 0.52 }}>
        {APP_NAME}
      </span>
    </span>
  );
}

// The app icon on its own
export function Mark({ size = 24, className = "" }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/asset/AppIcon.svg" alt="" width={size} height={size} className={`shrink-0 select-none ${className}`} />;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="tm-fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/25 p-3 pt-[6vh] backdrop-blur-[2px] md:p-4 md:pt-[10vh]" onMouseDown={onClose}>
      <div className={`tm-pop tm-float w-full rounded-2xl bg-white ${wide ? "max-w-2xl" : "max-w-lg"}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

export const btn =
  "rounded-xl bg-tm-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-tm-blue-dark active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";
export const btnGhost = "rounded-xl border border-tm-line bg-white px-4 py-2 text-sm font-medium transition hover:bg-tm-surface active:scale-[0.98]";
export const input =
  "w-full rounded-xl border border-tm-line bg-tm-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-tm-blue/50 focus:bg-white focus:ring-4 focus:ring-tm-blue/10";

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 rounded-xl bg-tm-surface p-1">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === id ? "tm-raised bg-white text-tm-blue" : "text-zinc-500 hover:text-zinc-800"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

export function EmojiPopover({ onPick, onClose, className = "" }: { onPick: (emoji: string) => void; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`tm-pop tm-float absolute z-40 overflow-hidden rounded-2xl ${className}`}>
      <EmojiPicker onEmojiClick={(e) => onPick(e.emoji)} lazyLoadEmojis previewConfig={{ showPreview: false }} width={320} height={380} />
    </div>
  );
}

const urlCache = new Map<string, string>();

export function useSignedUrl(path: string) {
  const [url, setUrl] = useState(urlCache.get(path) ?? null);
  useEffect(() => {
    if (urlCache.has(path)) return;
    supabase.storage
      .from("attachments")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (data) {
          urlCache.set(path, data.signedUrl);
          setUrl(data.signedUrl);
        }
      });
  }, [path]);
  return url;
}
