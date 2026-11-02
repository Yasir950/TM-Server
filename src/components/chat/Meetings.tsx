"use client";

import { useEffect, useState } from "react";
import { supabase, displayName, meetingEnd, meetingLive, type Meeting } from "@/lib/supabase";
import { dayLabel, timeOf } from "@/lib/format";
import { call } from "@/lib/brand";
import { Avatar, Modal, btn, btnGhost, input } from "../ui";
import { Icon } from "../icons";
import { useChat } from "./store";
import { EmptyState, ViewShell } from "./Views";

const DURATIONS = [15, 30, 45, 60, 90, 120];
const SOON = 15 * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// The next half hour at least 15 minutes away
function nextSlot() {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

// The start as the organizer sees it, with their time zone so others can convert
const whenLabel = (d: Date) =>
  d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

function dayOf(iso: string) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return new Date(iso).toDateString() === tomorrow.toDateString() ? "Tomorrow" : dayLabel(iso);
}

// Re-renders every `ms` so live/soon states change on time
export function useNow(ms: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const isInvited = (m: Meeting, uid: string) => m.meeting_invitees.some((i) => i.user_id === uid);

// Joins the meeting's call and opens its conversation when the user is in it
function useJoin() {
  const { channels, setHuddle, setActive } = useChat();
  return (m: Meeting) => {
    setHuddle(m.channel_id);
    if (channels[m.channel_id]) setActive(m.channel_id);
  };
}

export function ScheduleMeeting({ channelId, onClose }: { channelId?: string; onClose: () => void }) {
  const { me, profiles, channels, memberships, dmMembers, channelTitle, reload, reloadMeetings } = useChat();
  const [start] = useState(nextSlot);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => dateValue(start));
  const [time, setTime] = useState(() => timeValue(start));
  const [duration, setDuration] = useState(30);
  // A conversation id, or "dm" for a new call with just the people invited
  const [where, setWhere] = useState(channelId ?? "dm");
  const [invitees, setInvitees] = useState<string[]>(() => (channelId && channels[channelId]?.kind === "dm" ? (dmMembers[channelId] ?? []).filter((id) => id !== me.id) : []));
  const [channelMembers, setChannelMembers] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const target = where === "dm" ? undefined : channels[where];
  useEffect(() => {
    if (!target || target.kind === "dm") return;
    supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", target.id)
      .then(({ data }) => setChannelMembers(new Set((data ?? []).map((r) => r.user_id))));
  }, [target]);

  // Who can be invited: anyone for a new call, the members of a DM or private channel, any non-guest for a public channel
  const eligible = (id: string) =>
    id !== me.id &&
    (!target ||
      (target.kind === "dm" ? (dmMembers[target.id] ?? []).includes(id) : channelMembers.has(id) || (target.kind === "public" && profiles[id]?.role !== "guest")));
  const chosen = invitees.filter(eligible);
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? Object.values(profiles)
        .filter((p) => eligible(p.id) && !chosen.includes(p.id) && `${displayName(p)} ${p.username}`.toLowerCase().includes(needle))
        .slice(0, 6)
    : [];
  const everyone = target && target.kind !== "public" ? (target.kind === "dm" ? (dmMembers[target.id] ?? []) : [...channelMembers]).filter((id) => id !== me.id) : [];

  const places = Object.values(channels)
    .filter((c) => memberships[c.id] && !c.archived)
    .sort((a, b) => Number(a.kind === "dm") - Number(b.kind === "dm") || channelTitle(a).localeCompare(channelTitle(b)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const at = new Date(`${date}T${time}`);
    if (Number.isNaN(at.getTime())) return setError("Pick a date and time");
    if (at.getTime() < new Date().getTime() - 60_000) return setError("Pick a start time in the future");
    if (!chosen.length) return setError("Invite at least one person");
    setBusy(true);
    try {
      let channel = where;
      if (where === "dm") {
        const { data, error } = await supabase.rpc("get_or_create_dm", { p_user_ids: chosen });
        if (error) throw error;
        channel = data;
        await reload();
      }
      const { error } = await supabase.rpc("schedule_meeting", {
        p_channel: channel,
        p_title: title.trim(),
        p_starts_at: at.toISOString(),
        p_duration: duration,
        p_invitees: chosen,
        p_description: description.trim(),
        p_when_label: `${whenLabel(at)} (${duration} min)`,
      });
      if (error) throw error;
      await reloadMeetings();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Schedule a meeting" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <input autoFocus required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" className={input} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input type="date" required value={date} min={dateValue(new Date())} onChange={(e) => setDate(e.target.value)} className={`${input} col-span-2 sm:col-span-1`} />
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={input} />
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={input}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} min` : `${d / 60} h`}
              </option>
            ))}
          </select>
        </div>
        <label className="block text-sm font-medium">
          Where
          <select value={where} onChange={(e) => setWhere(e.target.value)} className={`${input} mt-1.5`}>
            <option value="dm">New {call} with the people invited</option>
            {places.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === "dm" ? channelTitle(c) : `${c.kind === "private" ? "🔒" : "#"} ${c.name}`}
              </option>
            ))}
          </select>
        </label>
        <div>
          <div className="flex items-center text-sm font-medium">
            <span className="flex-1">Invite</span>
            {everyone.length > 0 && chosen.length < everyone.length && (
              <button type="button" onClick={() => setInvitees(everyone)} className="text-xs font-medium text-tm-blue hover:underline">
                Invite everyone here
              </button>
            )}
          </div>
          {chosen.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {chosen.map((id) => (
                <span key={id} className="flex items-center gap-1.5 rounded-full border border-tm-line bg-tm-surface py-0.5 pr-1 pl-0.5 text-sm">
                  <Avatar profile={profiles[id]} size={20} />
                  {displayName(profiles[id])}
                  <button type="button" onClick={() => setInvitees(invitees.filter((x) => x !== id))} className="rounded-full p-0.5 text-zinc-400 hover:text-zinc-700" aria-label={`Remove ${displayName(profiles[id])}`}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people by name" className={`${input} mt-1.5`} />
          {matches.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setInvitees([...invitees, p.id]);
                    setQ("");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-tm-surface"
                >
                  <Avatar profile={p} size={24} />
                  <span className="flex-1 truncate">{displayName(p)}</span>
                  <span className="text-xs text-zinc-400">@{p.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <textarea value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="Agenda or notes (optional)" rows={3} className={`${input} resize-none`} />
        <p className="text-xs text-zinc-500">At the start time everyone invited is called in automatically and can join from the call screen.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button className={btn} disabled={busy || !title.trim()}>
            {busy ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MeetingCard({ m, now }: { m: Meeting; now: number }) {
  const { me, profiles, huddle, reloadMeetings } = useChat();
  const join = useJoin();
  const live = meetingLive(m, now);
  const over = now >= meetingEnd(m);
  const mine = m.meeting_invitees.find((i) => i.user_id === me.id);
  const organizer = m.created_by === me.id;
  const where = m.channels?.kind === "dm" ? "Direct call" : `#${m.channels?.name ?? "channel"}`;
  const going = m.meeting_invitees.filter((i) => i.response !== "declined");

  const respond = async (response: "accepted" | "declined") => {
    const { error } = await supabase.rpc("respond_meeting", { p_id: m.id, p_response: response });
    if (error) alert(error.message);
    else reloadMeetings();
  };
  const cancel = async () => {
    if (!confirm(`Cancel “${m.title}”? Everyone invited will be told.`)) return;
    const { error } = await supabase.rpc("cancel_meeting", { p_id: m.id });
    if (error) alert(error.message);
    else reloadMeetings();
  };

  const start = new Date(m.starts_at);
  return (
    <div className={`tm-fade-up flex gap-4 rounded-2xl border bg-white p-4 ${live ? "border-tm-green/50" : "border-tm-line"} ${over || m.cancelled_at ? "opacity-60" : ""}`}>
      <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-tm-surface py-1.5">
        <span className="text-[11px] font-semibold text-zinc-500 uppercase">{start.toLocaleDateString([], { month: "short" })}</span>
        <span className="text-xl leading-tight font-bold">{start.getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-[15px] font-semibold ${m.cancelled_at ? "line-through" : ""}`}>{m.title}</span>
          {live && <span className="shrink-0 rounded-full bg-tm-green px-2 py-px text-[11px] font-bold text-white">Live</span>}
          {m.cancelled_at && <span className="shrink-0 text-xs text-zinc-400">Cancelled</span>}
        </div>
        <div className="mt-0.5 text-sm text-zinc-500">
          {dayOf(m.starts_at)} · {timeOf(m.starts_at)}–{timeOf(new Date(meetingEnd(m)).toISOString())} · {where}
        </div>
        <div className="mt-0.5 text-xs text-zinc-400">Organized by {organizer ? "you" : displayName(profiles[m.created_by])}</div>
        {m.description && <p className="mt-1.5 line-clamp-3 text-sm whitespace-pre-wrap text-zinc-700">{m.description}</p>}
        <div className="mt-2 flex items-center gap-1" title={going.map((i) => displayName(profiles[i.user_id])).join(", ")}>
          {m.meeting_invitees.slice(0, 8).map((i) => (
            <span key={i.user_id} className={`relative ${i.response === "declined" ? "opacity-35 grayscale" : ""}`}>
              <Avatar profile={profiles[i.user_id]} size={22} />
              {i.response === "accepted" && <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-tm-green" />}
            </span>
          ))}
          <span className="ml-1 text-xs text-zinc-400">
            {going.length} going{m.meeting_invitees.length > 8 ? ` · ${m.meeting_invitees.length} invited` : ""}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {live && huddle !== m.channel_id && (
          <button onClick={() => join(m)} className={`${btn} flex items-center gap-1.5`}>
            <Icon name="headphones" size={16} />
            Join
          </button>
        )}
        {live && huddle === m.channel_id && <span className="text-sm text-tm-green">You&apos;re in</span>}
        {!over && !m.cancelled_at && mine && !organizer && (
          <div className="flex gap-1">
            {(["accepted", "declined"] as const).map((r) => (
              <button
                key={r}
                onClick={() => respond(r)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  mine.response === r ? (r === "accepted" ? "border-tm-green bg-tm-green text-white" : "border-zinc-700 bg-zinc-700 text-white") : "border-tm-line text-zinc-600 hover:bg-tm-surface"
                }`}
              >
                {r === "accepted" ? "Going" : "Decline"}
              </button>
            ))}
          </div>
        )}
        {!over && !m.cancelled_at && organizer && (
          <button onClick={cancel} className="text-xs text-zinc-400 transition hover:text-red-600">
            Cancel meeting
          </button>
        )}
      </div>
    </div>
  );
}

export function MeetingsView() {
  const { me, meetings } = useChat();
  const [scheduling, setScheduling] = useState(false);
  const now = useNow(15_000);
  const mine = meetings.filter((m) => isInvited(m, me.id));
  const current = mine.filter((m) => meetingEnd(m) > now && !m.cancelled_at);
  const past = mine.filter((m) => meetingEnd(m) <= now || m.cancelled_at).reverse();

  return (
    <ViewShell
      icon="calendar"
      title="Meetings"
      subtitle="Scheduled calls you're invited to"
      action={
        <button onClick={() => setScheduling(true)} className={`${btn} flex items-center gap-1.5`}>
          <Icon name="plus" size={16} />
          <span className="hidden sm:inline">Schedule</span>
        </button>
      }
    >
      {mine.length === 0 && <EmptyState icon="calendar" text="No meetings yet. Schedule one and everyone invited is called in when it starts." />}
      {current.map((m) => (
        <MeetingCard key={m.id} m={m} now={now} />
      ))}
      {past.length > 0 && <div className="pt-4 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Past and cancelled</div>}
      {past.map((m) => (
        <MeetingCard key={m.id} m={m} now={now} />
      ))}
      {scheduling && <ScheduleMeeting onClose={() => setScheduling(false)} />}
    </ViewShell>
  );
}

// Strip under a conversation's header while one of its meetings is live or about to start
export function MeetingBanner({ channelId }: { channelId: string }) {
  const { meetings, huddle } = useChat();
  const join = useJoin();
  const now = useNow(15_000);
  const m = meetings.find((x) => x.channel_id === channelId && !x.cancelled_at && Date.parse(x.starts_at) - SOON <= now && now < meetingEnd(x));
  if (!m || huddle === channelId) return null;
  const live = meetingLive(m, now);
  return (
    <div className="tm-fade flex shrink-0 items-center gap-2 border-b border-tm-line bg-tm-blue-light px-3 py-2 text-sm md:px-5">
      <Icon name="calendar" size={16} className="shrink-0 text-tm-blue" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{m.title}</span>
        <span className="text-zinc-600">{live ? ` is happening now · until ${timeOf(new Date(meetingEnd(m)).toISOString())}` : ` starts at ${timeOf(m.starts_at)}`}</span>
      </span>
      {live && (
        <button onClick={() => join(m)} className="shrink-0 rounded-lg bg-tm-blue px-3 py-1 text-xs font-semibold text-white transition hover:bg-tm-blue-dark">
          Join
        </button>
      )}
    </div>
  );
}
