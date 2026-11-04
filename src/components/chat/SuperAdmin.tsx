"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { supabase, fmtBytes, type PlanId, type Profile, type Role } from "@/lib/supabase";
import { Avatar, RowSkeleton, Skeleton, Tabs, btn, btnGhost, input } from "../ui";
import { useChat } from "./store";
import { ViewShell } from "./Views";
import { CompanyLogo } from "./Company";
import { Icon } from "../icons";

// Rows of the platform_* RPCs in supabase/migrations/*_super_admin.sql
type Stats = {
  companies: number;
  companies_30d: number;
  users: number;
  users_30d: number;
  channels: number;
  messages: number;
  messages_7d: number;
  active_7d: number;
  daily_companies: { day: string; count: number }[];
};
type CompanyRow = {
  id: string;
  name: string;
  handle: string;
  logo_url: string | null;
  created_at: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  members: number;
  channels: number;
  messages: number;
  messages_7d: number;
  last_activity: string | null;
  plan: PlanId;
  upgrade_requested_at: string | null;
  storage_bytes: number;
};
// public.contact_requests: the website's contact form and in-app upgrade requests
type Request = {
  id: string;
  kind: "sales" | "upgrade" | "general";
  name: string;
  email: string;
  company: string;
  team_size: string;
  message: string;
  company_id: string | null;
  handled_at: string | null;
  created_at: string;
};
type ChannelRow = { id: string; name: string | null; kind: "public" | "private" | "dm"; archived: boolean; members: number; messages: number; last_activity: string | null; people: string | null };
type UserRow = {
  id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  super_admin: boolean;
  companies: { id: string; name: string; role: Role; status: "active" | "deactivated" }[];
};

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "–");
const num = (n: number | undefined) => (n ?? 0).toLocaleString();

export default function SuperAdminView() {
  const [tab, setTab] = useState<"companies" | "users" | "requests">("companies");
  const [stats, setStats] = useState<Stats | null>(null);
  const [notice, setNotice] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    supabase.rpc("platform_stats").then(({ data, error }) => (error ? setNotice(error.message) : setStats(data as Stats)));
  }, []);

  // Last 30 days of new companies, including days with none
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 86400_000).toISOString().slice(0, 10);
    return { day: d, count: stats?.daily_companies.find((x) => x.day === d)?.count ?? 0 };
  });
  const peak = Math.max(1, ...days.map((d) => d.count));

  return (
    <ViewShell icon="shield" title="Super admin" subtitle="Every company and user on the platform">
      {notice && <div className="tm-fade rounded-xl bg-tm-blue-light px-4 py-2 text-sm text-tm-blue-dark">{notice}</div>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {(
          [
            ["Registered companies", stats?.companies, `+${num(stats?.companies_30d)} in 30 days`],
            ["Users", stats?.users, `+${num(stats?.users_30d)} in 30 days`],
            ["Messages · 7 days", stats?.messages_7d, `${num(stats?.messages)} all time`],
            ["Active users · 7 days", stats?.active_7d, `${num(stats?.channels)} channels`],
          ] as const
        ).map(([label, v, sub]) => (
          <div key={label} className="rounded-2xl border border-tm-line bg-white p-4">
            <div className="text-xs text-zinc-500">{label}</div>
            {stats ? (
              <>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{num(v)}</div>
                <div className="text-xs text-zinc-400">{sub}</div>
              </>
            ) : (
              <Skeleton className="mt-2 h-7 w-16" />
            )}
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-tm-line bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500">New companies per day · last 30 days</h2>
        <div className="flex h-24 items-end gap-0.5">
          {days.map((d) => (
            <div key={d.day} className="group flex h-full flex-1 items-end" title={`${d.day}: ${d.count}`}>
              <div className="w-full rounded-t bg-tm-blue/70 transition group-hover:bg-tm-blue" style={{ height: `${(d.count / peak) * 100}%`, minHeight: d.count ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-zinc-400">
          <span>{days[0].day.slice(5)}</span>
          <span>today</span>
        </div>
      </section>

      <div className="pt-2">
        <Tabs tabs={[["companies", "Companies"], ["users", "Users"], ["requests", "Requests"]]} value={tab} onChange={setTab} />
      </div>
      {tab === "companies" ? <Companies notify={setNotice} /> : tab === "users" ? <Users notify={setNotice} /> : <Requests notify={setNotice} />}
    </ViewShell>
  );
}

function Companies({ notify }: { notify: (s: string) => void }) {
  const { company, switchCompany, setActive, reload } = useChat();
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [chans, setChans] = useState<ChannelRow[] | null>(null);

  const load = useCallback(() => supabase.rpc("platform_companies").then(({ data, error }) => (error ? notify(error.message) : setRows(data ?? []))), [notify]);
  useEffect(() => {
    load();
  }, [load]);

  const expand = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setChans(null);
    const { data, error } = await supabase.rpc("platform_company_channels", { p_company: id });
    if (error) notify(error.message);
    setChans(data ?? []);
  };

  // Enters the company as its owner, optionally straight into one of its conversations
  const enter = async (companyId: string, channelId?: string) => {
    if (companyId !== company?.id) await switchCompany(companyId);
    if (channelId) setActive(channelId);
  };

  const remove = async (c: CompanyRow) => {
    if (prompt(`This permanently deletes ${c.name} with every channel, message and file in it. Type the handle "${c.handle}" to confirm.`) !== c.handle) return;
    const { error } = await supabase.rpc("platform_delete_company", { p_company: c.id });
    notify(error ? error.message : `${c.name} deleted`);
    if (error) return;
    setOpen(null);
    await Promise.all([load(), reload()]);
  };

  const setPlan = async (c: CompanyRow, plan: PlanId) => {
    if (!confirm(`Move ${c.name} from ${c.plan} to ${plan}?`)) return;
    const { error } = await supabase.rpc("set_company_plan", { p_company: c.id, p_plan: plan });
    notify(error ? error.message : `${c.name} is now on ${plan}`);
    if (error) return;
    await Promise.all([load(), reload()]);
  };

  const shown = rows?.filter((c) => `${c.name} ${c.handle} ${c.owner_name ?? ""} ${c.owner_email ?? ""} ${c.plan}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Icon name="search" size={16} className="absolute top-3 left-3 text-zinc-400" />
          <input className={`${input} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, handle or owner" />
        </div>
        {shown && <span className="text-sm text-zinc-500">{shown.length} {shown.length === 1 ? "company" : "companies"}</span>}
      </div>
      {!shown && <RowSkeleton />}
      <ul className="divide-y divide-tm-line rounded-2xl border border-tm-line bg-white">
        {shown?.map((c) => (
          <li key={c.id}>
            <div className="flex flex-wrap items-center gap-3 p-3">
              <button onClick={() => expand(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Icon name="chevronDown" size={16} className={`shrink-0 text-zinc-400 transition-transform ${open === c.id ? "" : "-rotate-90"}`} />
                <CompanyLogo company={c} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold text-zinc-900">{c.name}</span>
                    {c.id === company?.id && <span className="shrink-0 rounded-md bg-tm-blue-light px-1.5 py-0.5 text-[10px] font-medium text-tm-blue-dark">Viewing</span>}
                    {c.upgrade_requested_at && (
                      <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title={`Requested ${fmtDate(c.upgrade_requested_at)}`}>
                        Upgrade requested
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    @{c.handle} · owner {c.owner_name ?? "–"}
                    {c.owner_email ? ` (${c.owner_email})` : ""} · created {fmtDate(c.created_at)}
                  </span>
                </span>
              </button>
              <span className="flex gap-4 text-xs text-zinc-500 tabular-nums">
                <span title="Active members">{num(c.members)} members</span>
                <span title="Channels">{num(c.channels)} channels</span>
                <span title={`${num(c.messages)} messages all time`}>{num(c.messages_7d)} msgs · 7d</span>
                <span className="hidden md:inline" title="Last message">last {fmtDate(c.last_activity)}</span>
                <span title="File storage">{fmtBytes(c.storage_bytes)}</span>
              </span>
              <span className="flex gap-2">
                <select
                  className="rounded-lg border border-tm-line bg-white px-2 py-1 text-sm font-medium"
                  value={c.plan}
                  onChange={(e) => setPlan(c, e.target.value as PlanId)}
                  title="Plan"
                >
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
                <button className={btn} onClick={() => enter(c.id)}>Open</button>
                <button className={`${btnGhost} text-red-600`} onClick={() => remove(c)} title="Delete company">
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
            {open === c.id && (
              <div className="tm-fade border-t border-tm-line bg-tm-surface/50 px-3 py-2">
                {!chans && <RowSkeleton count={3} size={20} />}
                {chans?.length === 0 && <p className="py-2 text-sm text-zinc-400">No conversations yet</p>}
                <ul className="text-sm">
                  {chans?.map((ch, i) => (
                    <Fragment key={ch.id}>
                      {ch.kind === "dm" && chans[i - 1]?.kind !== "dm" && <li className="pt-3 pb-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Direct messages</li>}
                      <li className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white">
                        <span className="w-4 shrink-0 text-center text-zinc-400">{ch.kind === "public" ? "#" : ch.kind === "private" ? "🔒" : "@"}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {ch.kind === "dm" ? ch.people || "Empty conversation" : ch.name}
                          {ch.archived && <span className="ml-2 text-xs text-zinc-400">archived</span>}
                        </span>
                        <span className="hidden text-xs text-zinc-500 tabular-nums sm:inline">
                          {num(ch.members)} members · {num(ch.messages)} messages · last {fmtDate(ch.last_activity)}
                        </span>
                        <button className="text-tm-blue hover:underline" onClick={() => enter(c.id, ch.id)}>View</button>
                      </li>
                    </Fragment>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
        {shown?.length === 0 && <li className="p-6 text-center text-sm text-zinc-400">No companies match</li>}
      </ul>
    </div>
  );
}

const KIND_LABEL = { sales: "Enterprise", upgrade: "Upgrade", general: "Question" } as const;

function Requests({ notify }: { notify: (s: string) => void }) {
  const [rows, setRows] = useState<Request[] | null>(null);
  const [showHandled, setShowHandled] = useState(false);

  const load = useCallback(
    () =>
      supabase
        .from("contact_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200)
        .then(({ data, error }) => (error ? notify(error.message) : setRows(data ?? []))),
    [notify],
  );
  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (r: Request) => {
    const { error } = await supabase.from("contact_requests").update({ handled_at: r.handled_at ? null : new Date().toISOString() }).eq("id", r.id);
    if (error) notify(error.message);
    else load();
  };

  const shown = rows?.filter((r) => showHandled || !r.handled_at);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-zinc-600">
        <input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} />
        Show handled
      </label>
      {!shown && <RowSkeleton />}
      <ul className="divide-y divide-tm-line rounded-2xl border border-tm-line bg-white">
        {shown?.map((r) => (
          <li key={r.id} className={`p-4 ${r.handled_at ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${r.kind === "general" ? "bg-zinc-100 text-zinc-600" : r.kind === "upgrade" ? "bg-tm-green-light text-tm-green" : "bg-tm-blue-light text-tm-blue-dark"}`}
              >
                {KIND_LABEL[r.kind]}
              </span>
              <span className="font-semibold">{r.name}</span>
              <a href={`mailto:${r.email}`} className="text-sm text-tm-blue hover:underline">
                {r.email}
              </a>
              {r.company && <span className="text-sm text-zinc-500">· {r.company}</span>}
              {r.team_size && <span className="text-sm text-zinc-500">· {r.team_size} people</span>}
              <span className="ml-auto text-xs text-zinc-400">{fmtDate(r.created_at)}</span>
              <button className={btnGhost} onClick={() => toggle(r)}>
                {r.handled_at ? "Reopen" : "Mark handled"}
              </button>
            </div>
            {r.message && <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-700">{r.message}</p>}
          </li>
        ))}
        {shown?.length === 0 && <li className="p-6 text-center text-sm text-zinc-400">No open requests</li>}
      </ul>
    </div>
  );
}

function Users({ notify }: { notify: (s: string) => void }) {
  const { me, switchCompany } = useChat();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(() => supabase.rpc("platform_users").then(({ data, error }) => (error ? notify(error.message) : setRows(data ?? []))), [notify]);
  useEffect(() => {
    load();
  }, [load]);

  const toggleSuper = async (u: UserRow) => {
    const name = u.full_name || `@${u.username}`;
    if (!confirm(u.super_admin ? `Remove super admin access from ${name}?` : `Give ${name} super admin access? They will be able to see and manage every company.`)) return;
    const { error } = await supabase.rpc("set_super_admin", { p_user: u.id, p_on: !u.super_admin });
    notify(error ? error.message : u.super_admin ? `${name} is no longer a super admin` : `${name} is now a super admin`);
    if (!error) load();
  };

  const shown = rows?.filter((u) => `${u.full_name} ${u.username} ${u.email} ${u.companies.map((c) => c.name).join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Icon name="search" size={16} className="absolute top-3 left-3 text-zinc-400" />
          <input className={`${input} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or company" />
        </div>
        {shown && <span className="text-sm text-zinc-500">{shown.length} {shown.length === 1 ? "user" : "users"}</span>}
      </div>
      {!shown && <RowSkeleton />}
      <ul className="divide-y divide-tm-line rounded-2xl border border-tm-line bg-white">
        {shown?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 p-3">
            <Avatar profile={u as unknown as Profile} size={36} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-semibold text-zinc-900">{u.full_name || u.username}</span>
                <span className="truncate text-sm text-zinc-400">@{u.username}</span>
                {u.super_admin && <span className="shrink-0 rounded-md bg-tm-blue px-1.5 py-0.5 text-[10px] font-medium text-white">Super admin</span>}
              </span>
              <span className="block truncate text-xs text-zinc-500">
                {u.email} · joined {fmtDate(u.created_at)} · last sign-in {fmtDate(u.last_sign_in_at)}
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                {u.companies.length === 0 && <span className="text-xs text-zinc-400">No company</span>}
                {u.companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => switchCompany(c.id)}
                    title={`Open ${c.name}`}
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium transition hover:ring-1 hover:ring-tm-blue/40 ${c.status === "active" ? "bg-tm-surface text-zinc-700" : "bg-red-50 text-red-600 line-through"}`}
                  >
                    {c.name} · {c.role}
                  </button>
                ))}
              </span>
            </span>
            {u.id !== me.id && (
              <button className={btnGhost} onClick={() => toggleSuper(u)}>
                {u.super_admin ? "Remove super admin" : "Make super admin"}
              </button>
            )}
          </li>
        ))}
        {shown?.length === 0 && <li className="p-6 text-center text-sm text-zinc-400">No users match</li>}
      </ul>
    </div>
  );
}
