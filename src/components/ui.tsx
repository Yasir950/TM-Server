"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { supabase, displayName, activeStatus, type Profile } from "@/lib/supabase";
import { APP_NAME, RAIL } from "@/lib/brand";
import type { MentionUsers } from "@/lib/format";
import { Icon } from "./icons";

const palette = ["#1c75bc", "#39b54a", "#155a91", "#2d8a3a", "#4a90c9", "#5cb85c"];
export const avatarColor = (profile?: Profile) => palette[(profile?.id.charCodeAt(0) ?? 0) % palette.length];

// Lowercased username -> what an @mention chip shows
export const mentionUsers = (profiles: Record<string, Profile>): MentionUsers =>
  new Map(Object.values(profiles).map((p) => [p.username.toLowerCase(), { name: displayName(p), avatar: p.avatar_url, color: avatarColor(p) }]));

export function Avatar({ profile, size = 36, online, away }: { profile?: Profile; size?: number; online?: boolean; away?: boolean }) {
  const name = displayName(profile);
  const color = avatarColor(profile);
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
      {s.emoji ? <span className="shrink-0">{s.emoji}</span> : <Icon name="messages" size={14} className="text-zinc-400" />}
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

// Docked right pane beside the conversation, like Slack's profile and channel details: the main view narrows to make room
export function SidePanel({ title, onClose, children, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <aside
      className={`tm-slide-in tm-raised flex min-w-0 flex-1 flex-col overflow-hidden bg-white max-md:pb-[env(safe-area-inset-bottom)] md:rounded-2xl lg:flex-none lg:shrink-0 ${wide ? "lg:w-[460px]" : "lg:w-[400px]"}`}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-tm-line px-3 md:px-5">
        <h2 className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-lg font-semibold">{title}</h2>
        <button onClick={onClose} className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close">
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </aside>
  );
}

export function Modal({ title, onClose, children, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean | "xl" }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="tm-fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/25 p-3 pt-[6vh] backdrop-blur-[2px] md:p-4 md:pt-[10vh]" onMouseDown={onClose}>
      <div className={`tm-pop tm-float w-full rounded-2xl bg-white ${wide === "xl" ? "max-w-4xl" : wide ? "max-w-2xl" : "max-w-lg"}`} onMouseDown={(e) => e.stopPropagation()}>
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

// window.prompt() as a dialog of the app's own: the desktop app (Electron) has no prompt(). Resolves with the text or null.
export function askText(title: string, message: string, placeholder = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.body.appendChild(document.createElement("div"));
    import("react-dom/client").then(({ createRoot }) => {
      const root = createRoot(host);
      const done = (v: string | null) => {
        root.unmount();
        host.remove();
        resolve(v);
      };
      root.render(<AskText title={title} message={message} placeholder={placeholder} done={done} />);
    });
  });
}

function AskText({ title, message, placeholder, done }: { title: string; message: string; placeholder: string; done: (v: string | null) => void }) {
  const [v, setV] = useState("");
  return (
    <Modal title={title} onClose={() => done(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          done(v);
        }}
      >
        <p className="text-sm text-zinc-600">{message}</p>
        <input autoFocus className={`${input} mt-3`} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={() => done(null)}>
            Cancel
          </button>
          <button className={btn} disabled={!v.trim()}>
            OK
          </button>
        </div>
      </form>
    </Modal>
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

// Placeholder block shown while content loads; size and shape come from className
export const Skeleton = ({ className = "", style }: { className?: string; style?: React.CSSProperties }) => (
  <div className={`animate-pulse rounded-md bg-zinc-200/70 motion-reduce:animate-none ${className}`} style={style} />
);

// Varied line widths so stacked placeholders don't look like a grid
const widths = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-2/5"];

// Message rows: avatar, name + time, a line or two of body (matches MessageItem's spacing)
export function MessageSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading messages">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-3 px-6 pt-2.5 pb-1">
          <Skeleton className="h-9 w-9 shrink-0 rounded-[30%]" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="flex gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-10" />
            </div>
            <Skeleton className={`h-3.5 ${widths[i % widths.length]}`} />
            {i % 3 === 0 && <Skeleton className={`h-3.5 ${widths[(i + 2) % widths.length]}`} />}
          </div>
        </div>
      ))}
    </div>
  );
}

// Bordered result cards, as in the Threads, Saved, Search and Reminders views
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-3 rounded-2xl border border-tm-line bg-white p-4">
          <Skeleton className="h-[34px] w-[34px] shrink-0 rounded-[30%]" />
          <div className="flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className={`h-3.5 ${widths[i % widths.length]}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Compact list rows: icon/avatar and two short lines, for sidebar panels and modal lists
export function RowSkeleton({ count = 5, size = 32 }: { count?: number; size?: number }) {
  return (
    <div className="space-y-1" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
          {size > 0 && <Skeleton className="shrink-0 rounded-lg" style={{ width: size, height: size }} />}
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className={`h-3 ${widths[i % widths.length]}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// The whole app frame while the workspace boots: top bar, rail, sidebar and a conversation
export function AppSkeleton() {
  return (
    <div className="flex h-full flex-col" style={{ background: RAIL }} aria-busy="true" aria-label="Loading">
      <div className="flex h-12 shrink-0 items-center gap-4 px-4">
        <div className="h-8 w-8 shrink-0 animate-pulse rounded-[25%] bg-white/15 motion-reduce:animate-none" />
        <div className="mx-auto h-8 w-full max-w-xl animate-pulse rounded-xl bg-white/10 motion-reduce:animate-none" />
        <div className="h-[30px] w-[30px] shrink-0 animate-pulse rounded-[30%] bg-white/15 motion-reduce:animate-none" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-12 shrink-0 flex-col items-center gap-2 pt-3 md:flex">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 w-9 animate-pulse rounded-xl bg-white/10 motion-reduce:animate-none" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 bg-tm-surface md:gap-2 md:rounded-tl-2xl md:p-2">
          <div className="w-full shrink-0 space-y-2 px-2 pt-3 md:w-64 md:p-0 md:pt-1.5">
            <Skeleton className="mx-2.5 mb-4 h-6 w-32" />
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className={`flex items-center gap-2.5 px-2.5 py-1 ${i === 4 ? "mt-6" : ""}`}>
                <Skeleton className="h-4 w-4 shrink-0" />
                <Skeleton className={`h-3.5 ${widths[i % widths.length]}`} />
              </div>
            ))}
          </div>
          <div className="tm-raised hidden min-w-0 flex-1 flex-col overflow-hidden bg-white md:flex md:rounded-2xl">
            <div className="flex h-14 shrink-0 items-center border-b border-tm-line px-6">
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="flex-1 overflow-hidden pt-2">
              <MessageSkeleton count={7} />
            </div>
          </div>
        </div>
      </div>
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
