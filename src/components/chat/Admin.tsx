"use client";

import { useEffect, useState } from "react";
import { supabase, displayName, type Profile } from "@/lib/supabase";
import { Avatar, Skeleton, btn, btnGhost, input } from "../ui";
import { useChat } from "./store";
import { ViewShell } from "./Views";
import AdminPlatform from "./AdminPlatform";

type Stats = {
  members: number;
  channels: number;
  messages_7d: number;
  active_7d: number;
  daily: { day: string; count: number }[];
  top_channels: { name: string; count: number }[];
};

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-tm-line bg-white p-5">
    <h2 className="mb-3 text-sm font-semibold text-zinc-500">{title}</h2>
    {children}
  </section>
);

export default function AdminView() {
  const { me, profiles } = useChat();
  const [stats, setStats] = useState<Stats | null>(null);
  const [retention, setRetention] = useState("");
  const [notice, setNotice] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    supabase.rpc("admin_stats").then(({ data }) => setStats(data as Stats));
    supabase
      .from("workspace_settings")
      .select("retention_days")
      .single()
      .then(({ data }) => setRetention(data?.retention_days?.toString() ?? ""));
  }, []);

  // Last 14 days, including days with no messages
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * 86400_000).toISOString().slice(0, 10);
    return { day: d, count: stats?.daily.find((x) => x.day === d)?.count ?? 0 };
  });
  const peak = Math.max(1, ...days.map((d) => d.count));

  const setRole = async (p: Profile, role: string) => {
    const { error } = await supabase.rpc("set_member_role", { p_user: p.id, p_role: role });
    setNotice(error ? error.message : `${displayName(p)} is now ${role === "admin" ? "an admin" : "a member"}`);
  };

  const saveRetention = async () => {
    const days = retention.trim() ? Math.max(1, Math.floor(Number(retention))) : null;
    const { error } = await supabase.from("workspace_settings").update({ retention_days: days, updated_at: new Date().toISOString() }).eq("id", true);
    setNotice(error ? error.message : days ? `Messages older than ${days} days will be deleted daily (pinned messages are kept)` : "Messages are kept forever");
  };

  const runRetention = async () => {
    const { data, error } = await supabase.rpc("apply_retention");
    setNotice(error ? error.message : `${data} messages deleted`);
  };

  return (
    <ViewShell icon="wrench" title="Admin" subtitle="Analytics, members, retention, workflows, DLP, events and audit log">
      {notice && <div className="tm-fade rounded-xl bg-tm-blue-light px-4 py-2 text-sm text-tm-blue-dark">{notice}</div>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {(
          [
            ["Members", stats?.members],
            ["Channels", stats?.channels],
            ["Messages · 7 days", stats?.messages_7d],
            ["Active members · 7 days", stats?.active_7d],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-2xl border border-tm-line bg-white p-4">
            <div className="text-xs text-zinc-500">{label}</div>
            {stats ? <div className="mt-1 text-2xl font-semibold tabular-nums">{v ?? "–"}</div> : <Skeleton className="mt-2 h-7 w-16" />}
          </div>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-[2fr_1fr]">
        <Card title="Messages per day · last 14 days">
          <div className="flex h-32 items-end gap-1">
            {days.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.day}: ${d.count}`}>
                <div className="w-full rounded-t bg-tm-blue/70 transition group-hover:bg-tm-blue" style={{ height: `${(d.count / peak) * 100}%`, minHeight: d.count ? 2 : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-zinc-400">
            <span>{days[0].day.slice(5)}</span>
            <span>today</span>
          </div>
        </Card>
        <Card title="Busiest channels · 30 days">
          {!stats && <div className="space-y-2.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-3.5 w-full" />)}</div>}
          {stats?.top_channels.length === 0 &&<p className="text-sm text-zinc-400">No channel activity yet</p>}
          <ul className="space-y-1.5 text-sm">
            {stats?.top_channels.map((c) => (
              <li key={c.name} className="flex justify-between">
                <span className="truncate">#{c.name}</span>
                <span className="tabular-nums text-zinc-500">{c.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Members">
        <ul className="divide-y divide-tm-line">
          {Object.values(profiles)
            .sort((a, b) => displayName(a).localeCompare(displayName(b)))
            .map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <Avatar profile={p} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-semibold">{displayName(p)}</span> <span className="text-zinc-400">@{p.username}</span>
                </span>
                {p.role === "owner" || p.id === me.id ? (
                  <span className="text-xs text-zinc-500 capitalize">{p.role}</span>
                ) : (
                  <select className="rounded-lg border border-tm-line bg-white px-2 py-1 text-xs" value={p.role} onChange={(e) => setRole(p, e.target.value)}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
              </li>
            ))}
        </ul>
      </Card>

      <Card title="Message retention">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Delete messages older than</span>
          <input className={`${input} w-24`} type="number" min={1} placeholder="∞" value={retention} onChange={(e) => setRetention(e.target.value)} />
          <span className="text-sm">days</span>
          <button className={btn} onClick={saveRetention}>
            Save
          </button>
          <button className={btnGhost} onClick={runRetention} disabled={!retention.trim()}>
            Run now
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-400">Leave empty to keep messages forever. Pinned messages are never deleted. Runs daily when pg_cron is enabled.</p>
      </Card>

      <AdminPlatform notify={setNotice} />
    </ViewShell>
  );
}
