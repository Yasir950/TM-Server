"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, displayName, activeStatus, inDnd, isAdmin, uploadImage, type Company, type Profile, type Role } from "@/lib/supabase";
import { signOut } from "@/lib/push";
import { Avatar, askText, Logo, Modal, SidePanel, StatusBadge, Tabs, avatarColor, btn, btnGhost, input } from "../ui";
import { useChat } from "./store";
import { ViewShell } from "./Views";
import { Icon } from "../icons";
import { CALL } from "@/lib/brand";

const INVITE_KEY = "tm-invite";
export const inviteUrl = (token: string) => `${window.location.origin}/app?invite=${token}`;
const roleLabel: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
const roleTag: Record<Role, string> = {
  owner: "bg-tm-blue text-white",
  admin: "bg-tm-blue-light text-tm-blue-dark",
  member: "bg-tm-green-light text-tm-green",
  guest: "bg-amber-50 text-amber-700",
};
const fmtDate =(d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "–");

const readInvite = () => {
  try {
    return localStorage.getItem(INVITE_KEY);
  } catch {
    return null;
  }
};
const clearInvite = () => {
  try {
    localStorage.removeItem(INVITE_KEY);
  } catch {}
};

export function CompanyLogo({ company, size = 32 }: { company?: Pick<Company, "name" | "logo_url"> | null; size?: number }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-[30%] bg-tm-blue text-white" style={{ width: size, height: size }}>
      {company?.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={company.logo_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-semibold" style={{ fontSize: size * 0.45 }}>
          {company?.name.slice(0, 1).toUpperCase() ?? "?"}
        </div>
      )}
    </div>
  );
}

function ImagePicker({ label, onFile }: { label: string; onFile: (f: File) => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className={btnGhost} disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "Uploading…" : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            await onFile(f);
          } catch (err) {
            alert((err as Error).message);
          }
          setBusy(false);
        }}
      />
    </>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1 text-sm">
    <span className="text-zinc-500">{label}</span>
    {children}
  </label>
);

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-2xl border border-tm-line bg-white p-5">
    <h2 className="text-sm font-semibold text-zinc-500">{title}</h2>
    {children}
  </section>
);

// Onboarding: shown until the user belongs to a company -------------------

export function Onboarding({ onClose }: { onClose?: () => void }) {
  const { me, reload } = useChat();
  const [tab, setTab] = useState<"create" | "invite" | "find">("create");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [token, setToken] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; logo_url: string | null; member_count: number } | null | undefined>();
  const [requests, setRequests] = useState<{ company_id: string; status: string; created_at: string }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("join_requests").select("company_id,status,created_at").then(({ data }) => setRequests(data ?? []));
  }, []);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    setError("");
    const { error } = await p;
    if (error) return setError(error.message), false;
    await reload();
    onClose?.();
    return true;
  };

  const body = (
    <div className="space-y-4">
      <Tabs tabs={[["create", "Create"], ["invite", "Join with invite"], ["find", "Find"]]} value={tab} onChange={setTab} />
      {tab === "create" && (
        <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), run(supabase.rpc("create_company", { p_name: name, p_handle: handle })))}>
          <Field label="Company name">
            <input className={input} value={name} required autoFocus placeholder="e.g. Acme Inc." onChange={(e) => (setName(e.target.value), setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 39)))} />
          </Field>
          <Field label="Company handle">
            <input className={input} value={handle} required pattern="[a-z0-9][a-z0-9\-]{1,38}" onChange={(e) => setHandle(e.target.value.toLowerCase())} />
            <span className="block text-xs text-zinc-400">Lowercase letters, numbers and dashes. Teammates use it to find you.</span>
          </Field>
          <button className={`${btn} w-full py-2.5`}>Create company</button>
        </form>
      )}
      {tab === "invite" && (
        <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), run(supabase.rpc("accept_invite", { p_token: token.trim().split("invite=").pop() })))}>
          <Field label="Invite link or code">
            <input className={input} value={token} required onChange={(e) => setToken(e.target.value)} placeholder="https://…/?invite=…" />
            <span className="block text-xs text-zinc-400">Paste the link an admin sent you.</span>
          </Field>
          <button className={`${btn} w-full py-2.5`}>Join company</button>
        </form>
      )}
      {tab === "find" && (
        <div className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const { data } = await supabase.rpc("find_company", { p_handle: handle });
              setFound(data?.[0] ?? null);
            }}
          >
            <input className={input} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Company handle, e.g. acme" />
            <button className={btnGhost}>Search</button>
          </form>
          {found === null && <p className="text-sm text-zinc-500">No company with that handle accepts join requests.</p>}
          {found && (
            <div className="flex items-center gap-3 rounded-xl border border-tm-line p-3">
              <CompanyLogo company={found} />
              <div className="flex-1">
                <div className="font-semibold">{found.name}</div>
                <div className="text-xs text-zinc-500">{found.member_count} members</div>
              </div>
              <button
                className={btn}
                onClick={async () => {
                  const { error } = await supabase.rpc("request_join", { p_company: found.id });
                  setError(error ? error.message : "");
                  if (!error) setRequests((r) => [...r.filter((x) => x.company_id !== found.id), { company_id: found.id, status: "pending", created_at: new Date().toISOString() }]);
                }}
              >
                Request to join
              </button>
            </div>
          )}
          {requests.some((r) => r.status === "pending") && (
            <p className="text-sm text-zinc-500">
              {requests.filter((r) => r.status === "pending").length} join request(s) waiting for an admin to approve.
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );

  if (onClose) return <Modal title="Add a company" onClose={onClose}>{body}</Modal>;
  return (
    <div className="flex min-h-full flex-col items-center justify-center overflow-y-auto bg-tm-surface px-4 py-12">
      <Logo height={48} />
      <h1 className="mt-8 text-center text-3xl font-bold">Welcome{me ? `, ${displayName(me).split(" ")[0]}` : ""} 👋</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-zinc-500">Create a company for your team, or join one you&apos;ve been invited to.</p>
      <div className="tm-raised mt-8 w-full max-w-md rounded-2xl bg-white p-6">{body}</div>
      <p className="mt-6 text-sm text-zinc-500">
        Not you?{" "}
        <button className="font-semibold text-tm-blue hover:underline" onClick={signOut}>
          Sign out
        </button>
      </p>
    </div>
  );
}

// Accepts an invite opened from a link (saved before sign-in by lib/supabase)
export function InviteFromUrl() {
  const { reload } = useChat();
  const [token, setToken] = useState<string | null>(readInvite);
  const [info, setInfo] = useState<{ company_name: string; company_logo: string | null; role: Role; valid: boolean } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (token) supabase.rpc("invite_info", { p_token: token }).then(({ data }) => (data?.[0] ? setInfo(data[0]) : (clearInvite(), setToken(null))));
  }, [token]);

  if (!token || !info) return null;
  const close = () => (clearInvite(), setToken(null), window.history.replaceState(null, "", "/app"));
  return (
    <Modal title="Company invitation" onClose={close}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <CompanyLogo company={{ name: info.company_name, logo_url: info.company_logo }} size={44} />
          <p className="text-sm">
            You were invited to join <b>{info.company_name}</b> as a {roleLabel[info.role].toLowerCase()}.
          </p>
        </div>
        {!info.valid && <p className="text-sm text-red-600">This invitation has expired or was revoked.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={close}>Not now</button>
          {info.valid && (
            <button
              className={btn}
              onClick={async () => {
                const { error } = await supabase.rpc("accept_invite", { p_token: token });
                if (error) return setError(error.message);
                close();
                await reload();
              }}
            >
              Join {info.company_name}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Sidebar header: current company + switcher --------------------------------

export function CompanySwitcher() {
  const { company, companies, switchCompany, setView } = useChat();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mb-2">
      <button onClick={() => setOpen(!open)} className="flex max-w-full items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-left transition hover:bg-white">
        <span className="truncate text-lg font-bold text-zinc-900">{company?.name}</span>
        <Icon name="chevronDown" size={18} className="text-zinc-600" />
      </button>
      {open && (
        <div className="tm-pop tm-float absolute top-12 right-0 left-0 z-40 rounded-2xl bg-white p-2 text-sm" onMouseLeave={() => setOpen(false)}>
          {companies.map((c) => (
            <button key={c.id} onClick={() => (setOpen(false), c.id !== company?.id && switchCompany(c.id))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-tm-blue-light">
              <CompanyLogo company={c} size={22} />
              <span className="flex-1 truncate text-left">{c.name}</span>
              {c.id === company?.id && <span className="text-tm-blue">✓</span>}
            </button>
          ))}
          <div className="my-1 h-px bg-tm-line" />
          <button onClick={() => (setOpen(false), setView("company"))} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-tm-blue-light">Company details</button>
        </div>
      )}
    </div>
  );
}

// Members directory -------------------------------------------------------

// Square profile photo that fills its box, or the person's initial on their avatar colour
function Photo({ profile, className = "" }: { profile?: Profile; className?: string }) {
  return profile?.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={profile.avatar_url} alt="" className={`object-cover ${className}`} />
  ) : (
    <span className={`flex items-center justify-center text-5xl font-semibold text-white ${className}`} style={{ background: avatarColor(profile) }}>
      {displayName(profile).charAt(0).toUpperCase()}
    </span>
  );
}

// Presence dot colour and label, matching Avatar's online/away dot
const presence = (online: boolean, away: boolean) => (online && !away ? ["bg-tm-green", "Active"] : online ? ["bg-amber-400", "Away"] : ["bg-zinc-300", "Offline"]);

export function MembersView() {
  const { me, members, profiles, online, away, showMember } = useChat();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("active");
  const [dept, setDept] = useState("");
  const [inviting, setInviting] = useState(false);
  const admin = isAdmin(me);
  const depts = [...new Set(Object.values(members).map((m) => m.department).filter(Boolean))].sort();
  const rows = Object.values(members)
    .filter((m) => (!role || m.role === role) && (!status || m.status === status) && (!dept || m.department === dept))
    .filter((m) => `${displayName(profiles[m.user_id])} ${profiles[m.user_id]?.username} ${m.designation} ${m.department} ${m.email ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => displayName(profiles[a.user_id]).localeCompare(displayName(profiles[b.user_id])));
  const active = Object.values(members).filter((m) => m.status === "active");
  const activeNow = active.filter((m) => online.has(m.user_id) && !away.has(m.user_id)).length;

  return (
    <ViewShell
      icon="users"
      title="Members"
      subtitle={`${active.length} members · ${activeNow} active now`}
      action={(admin || me.role === "member") && <button className={btn} onClick={() => setInviting(true)}>Invite people</button>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative w-full sm:max-w-xs">
            <Icon name="search" size={16} className="absolute top-3 left-3 text-zinc-400" />
            <input className={`${input} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, title, department, email" />
          </div>
          <select className={`${input} w-auto`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {depts.length > 0 && (
            <select className={`${input} w-auto`} value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {depts.map((d) => <option key={d}>{d}</option>)}
            </select>
          )}
          {admin && (
            <select className={`${input} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
              <option value="">All statuses</option>
            </select>
          )}
        </div>
        <p className="text-sm text-zinc-500">
          {rows.length} {rows.length === 1 ? "result" : "results"}
        </p>
        {/* People directory: a card per teammate, like Slack's */}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
          {rows.map((m) => {
            const p = profiles[m.user_id];
            const [dot, label] = presence(online.has(m.user_id), away.has(m.user_id));
            return (
              <li key={m.user_id}>
                <button
                  onClick={() => showMember(m.user_id)}
                  className="tm-fade-up flex h-full w-full flex-col overflow-hidden rounded-xl border border-tm-line bg-white text-left transition hover:-translate-y-px hover:border-tm-blue/30"
                >
                  <span className="relative block">
                    <Photo profile={p} className={`aspect-square w-full ${m.status === "deactivated" ? "opacity-50 grayscale" : ""}`} />
                    {m.status === "active" && <span title={label} className={`absolute right-1.5 bottom-1.5 h-3 w-3 rounded-full border-2 border-white ${dot}`} />}
                  </span>
                  <span className="block min-w-0 p-2">
                    <span className="flex items-center gap-1 text-sm font-semibold text-zinc-900">
                      <span className="truncate">{displayName(p)}</span>
                      <StatusBadge profile={p} />
                      {m.user_id === me.id && <span className="shrink-0 text-xs font-normal text-zinc-400">(you)</span>}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">{m.designation || `@${p?.username}`}</span>
                    <span className="mt-1 flex flex-wrap gap-1 text-[10px] font-medium">
                      <span className={`rounded-md px-1.5 py-0.5 ${roleTag[m.role]}`}>{roleLabel[m.role]}</span>
                      {m.status === "deactivated" && <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-red-600">Deactivated</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {rows.length === 0 && <p className="py-12 text-center text-sm text-zinc-400">No members match</p>}
      </div>
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
    </ViewShell>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const { me } = useChat();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [links, setLinks] = useState<{ email: string; token: string }[]>([]);
  const [error, setError] = useState("");
  const send = async () => {
    const list = [...new Set(emails.match(/[^\s,;<>"]+@[^\s,;<>"]+\.[a-z]{2,}/gi) ?? [])];
    if (!list.length) return setError("Enter at least one email address");
    const { data, error } = await supabase.rpc("invite_members", { p_emails: list, p_role: role });
    setError(error?.message ?? "");
    if (data) {
      setLinks(data);
      setEmails("");
    }
  };
  return (
    <Modal title="Invite people" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Email addresses (comma or new line separated, or import a CSV)">
          <textarea className={`${input} h-24`} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ana@acme.com, li@acme.com" />
        </Field>
        <div className="flex items-center gap-2">
          <input type="file" accept=".csv,text/csv" className="text-xs" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const text = await f.text(); setEmails((x) => `${x}\n${text}`); }} />
          <select className={`${input} ml-auto w-auto`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {isAdmin(me) && <option value="admin">Admin</option>}
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </select>
          <button className={btn} onClick={send}>Create invites</button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {links.length > 0 && (
          <div className="space-y-1 rounded-xl bg-tm-surface p-3 text-sm">
            <p className="text-zinc-500">Send each person their join link (valid 30 days, single use):</p>
            {links.map((l) => (
              <div key={l.token} className="flex items-center gap-2">
                <span className="flex-1 truncate">{l.email}</span>
                <button className="text-tm-blue hover:underline" onClick={() => navigator.clipboard.writeText(inviteUrl(l.token))}>Copy link</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Member details card -------------------------------------------------------

const InfoList = ({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) => (
  <section className="space-y-2.5 border-t border-tm-line pt-4">
    <h4 className="text-sm font-semibold text-zinc-900">{title}</h4>
    <dl className="space-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-zinc-500">{k}</dt>
          <dd className="truncate">{v}</dd>
        </div>
      ))}
    </dl>
  </section>
);

// Profile pane docked on the right, opened by clicking anyone's name or card
export function MemberCard() {
  const { me, members, profiles, online, away, memberCard, showMember, setActive, setHuddle, reload } = useChat();
  const m = memberCard ? members[memberCard] : undefined;
  const p = memberCard ? profiles[memberCard] : undefined;
  const [designation, setDesignation] = useState(m?.designation ?? "");
  const [department, setDepartment] = useState(m?.department ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  if (!m || !p) return null;
  const admin = isAdmin(me);
  const self = m.user_id === me.id;
  const status = activeStatus(p);
  const [dot, label] = presence(online.has(p.id), away.has(p.id));
  const close = () => showMember(null);
  const rpc = async (fn: string, args: object) => {
    const { error } = await supabase.rpc(fn, args);
    setError(error?.message ?? "");
    if (!error) await reload();
  };
  // Opens (creating if needed) the DM with this person and returns its id
  const openDm = async () => {
    const { data, error } = await supabase.rpc("get_or_create_dm", { p_user_ids: [m.user_id] });
    if (error) return setError(error.message), null;
    await reload();
    close();
    setActive(data);
    return data as string;
  };
  const contact: [string, React.ReactNode][] = [
    ["Email", m.email ? <a className="text-tm-blue hover:underline" href={`mailto:${m.email}`}>{m.email}</a> : "Hidden"],
    ["Phone", m.phone ? <a className="text-tm-blue hover:underline" href={`tel:${m.phone}`}>{m.phone}</a> : "Not shared"],
  ];
  const about: [string, React.ReactNode][] = [
    ["Department", m.department || "–"],
    ["Role", roleLabel[m.role]],
    ["Joined", fmtDate(m.joined_at)],
    ...(admin
      ? ([
          ["Status", m.status === "active" ? "Active" : "Deactivated"],
          ["Last sign-in", fmtDate(m.last_sign_in_at)],
          ["Invited by", m.invited_by ? displayName(profiles[m.invited_by]) : "–"],
        ] as [string, React.ReactNode][])
      : []),
  ];

  return (
    <SidePanel title="Profile" onClose={close}>
      <div className="space-y-5">
        <div className="flex justify-center">
          <Photo profile={p} className={`h-32 w-32 rounded-2xl ${m.status === "deactivated" ? "opacity-50 grayscale" : ""}`} />
        </div>
        <div className="space-y-1 text-center">
          <h3 className="text-xl font-bold text-zinc-900">
            {displayName(p)}
            {self && <span className="ml-1.5 text-sm font-normal text-zinc-400">(you)</span>}
          </h3>
          {m.designation && <p className="text-[15px] text-zinc-700">{m.designation}</p>}
          <p className="text-sm text-zinc-500">@{p.username}</p>
          {status && (
            <p className="flex items-center justify-center gap-1.5 pt-1 text-sm text-zinc-700">
              <span>{status.emoji || "💬"}</span>
              <span className="truncate">{status.text}</span>
            </p>
          )}
          {m.status === "active" ? (
            <p className="flex items-center justify-center gap-2 pt-1 text-sm text-zinc-600">
              <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
              {label}
              {inDnd(p) && <span className="text-zinc-400">· 🌙 Notifications paused</span>}
            </p>
          ) : (
            <p className="pt-1 text-sm font-medium text-red-600">Deactivated</p>
          )}
        </div>
        <div className="flex gap-2">
          {self ? (
            <button className={`${btnGhost} flex-1`} onClick={() => setEditing(true)}>Edit profile</button>
          ) : (
            m.status === "active" && (
              <>
                <button className={`${btn} flex flex-1 items-center justify-center gap-2`} onClick={openDm}>
                  <Icon name="messages" size={16} />
                  Message
                </button>
                <button className={`${btnGhost} flex flex-1 items-center justify-center gap-2`} onClick={async () => { const id = await openDm(); if (id) setHuddle(id); }}>
                  <Icon name="headphones" size={16} />
                  {CALL}
                </button>
              </>
            )
          )}
        </div>
        <InfoList title="Contact information" rows={contact} />
        <InfoList title="About" rows={about} />
        {admin && !self && m.role !== "owner" && (
          <div className="space-y-3 rounded-xl border border-tm-line p-3">
            <div className="text-sm font-semibold text-zinc-500">Admin</div>
            <div className="grid grid-cols-2 gap-2">
              <input className={input} value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Designation" />
              <input className={input} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Department" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className={btnGhost}
                onClick={async () => {
                  const { error } = await supabase.from("company_members").update({ designation, department }).eq("company_id", me.current_company_id).eq("user_id", m.user_id);
                  setError(error?.message ?? "");
                  if (!error) await reload();
                }}
              >
                Save details
              </button>
              <select className={`${input} w-auto`} value={m.role} onChange={(e) => rpc("set_member_role", { p_user: m.user_id, p_role: e.target.value })}>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="guest">Guest</option>
              </select>
              <button className={btnGhost} onClick={() => rpc("set_member_status", { p_user: m.user_id, p_active: m.status !== "active" })}>
                {m.status === "active" ? "Deactivate" : "Reactivate"}
              </button>
              {me.role === "owner" && m.status === "active" && (
                <button className={btnGhost} onClick={() => confirm(`Make ${displayName(p)} the owner? You will become an admin.`) && rpc("transfer_ownership", { p_user: m.user_id })}>
                  Transfer ownership
                </button>
              )}
              <button
                className={`${btnGhost} text-red-600`}
                onClick={async () => {
                  if (!confirm(`Remove ${displayName(p)} from the company? They lose access to its channels and projects. Their messages stay.`)) return;
                  const { error } = await supabase.rpc("remove_member", { p_user: m.user_id });
                  setError(error?.message ?? "");
                  if (error) return;
                  close();
                  await reload();
                }}
              >
                Remove from company
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {editing && <ProfileModal onClose={() => setEditing(false)} />}
    </SidePanel>
  );
}

// My profile -----------------------------------------------------------------

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { me, members, reload } = useChat();
  const mine = members[me.id];
  const [fullName, setFullName] = useState(me.full_name);
  const [username, setUsername] = useState(me.username);
  const [designation, setDesignation] = useState(mine?.designation ?? "");
  const [phone, setPhone] = useState(mine?.phone ?? "");
  const [phoneVisible, setPhoneVisible] = useState(mine?.phone_visible ?? false);
  const [email, setEmail] = useState(mine?.email ?? "");
  // The account's real email and any change still waiting for confirmation, read from Supabase Auth
  // (members[].email only changes once a change is confirmed, so comparing against it re-sends emails)
  const [authEmail, setAuthEmail] = useState<{ current: string; pending: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const current = data.user?.email ?? "";
      const pending = data.user?.new_email ?? "";
      setAuthEmail({ current, pending });
      if (current) setEmail(pending || current);
    });
  }, []);

  const save = async () => {
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone.replace(/[\s()-]/g, ""))) return setNotice("Enter the phone number with its country code, e.g. +44 20 7946 0000");
    const nextEmail = email.trim().toLowerCase();
    if (nextEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nextEmail)) return setNotice("Enter a valid email address.");
    const current = (authEmail?.current ?? mine?.email ?? "").toLowerCase();
    const pending = (authEmail?.pending ?? "").toLowerCase();
    // Only ask Supabase to send confirmation emails for a genuinely new address
    const emailChanged = !!nextEmail && nextEmail !== current && nextEmail !== pending;

    setBusy(true);
    setNotice("");
    const [profileRes, memberRes] = await Promise.all([
      supabase.from("profiles").update({ full_name: fullName.trim(), username: username.trim().toLowerCase() }).eq("id", me.id),
      supabase.from("company_members").update({ designation: designation.trim(), phone: phone.replace(/[\s()-]/g, ""), phone_visible: phoneVisible }).eq("company_id", me.current_company_id).eq("user_id", me.id),
    ]);
    const profileErr = profileRes.error ?? memberRes.error;
    if (profileErr) {
      setBusy(false);
      return setNotice(profileErr.message);
    }

    let emailMsg = "";
    if (emailChanged) {
      const { error } = await supabase.auth.updateUser({ email: nextEmail }, { emailRedirectTo: `${window.location.origin}/app` });
      if (!error) {
        setAuthEmail({ current, pending: nextEmail });
        emailMsg = ` Check ${current || "your old inbox"} and ${nextEmail} to confirm the new email address.`;
      } else if (error.status === 429 || /rate limit/i.test(error.message)) {
        emailMsg = " Your email wasn't changed: too many confirmation emails were sent recently. Please try again in an hour.";
      } else {
        emailMsg = ` Your email wasn't changed: ${error.message}`;
      }
    } else if (pending && nextEmail === pending) {
      emailMsg = ` Your change to ${pending} is still waiting for confirmation. Check both inboxes.`;
    }

    await reload();
    setBusy(false);
    setNotice(`Profile saved.${emailMsg}`);
  };

  return (
    <Modal title="Edit profile" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar profile={me} size={64} />
          <ImagePicker
            label="Upload photo"
            onFile={async (f) => {
              const url = await uploadImage(me.id, f);
              await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
              await reload();
            }}
          />
          {me.avatar_url && (
            <button className="text-sm text-zinc-500 hover:underline" onClick={async () => (await supabase.from("profiles").update({ avatar_url: null }).eq("id", me.id), reload())}>
              Remove
            </button>
          )}
        </div>
        <Field label="Full name"><input className={input} value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Display name"><input className={input} value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Designation"><input className={input} value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Sales Manager" /></Field>
        <Field label="Email"><input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Phone number"><input className={input} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 010 0000" /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={phoneVisible} onChange={(e) => setPhoneVisible(e.target.checked)} />
          Show my phone number to the company
        </label>
        {notice && <p className="text-sm text-zinc-600">{notice}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Close</button>
          <button className={btn} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}

// Company details + settings ------------------------------------------------

type Invite = { id: string; email: string | null; role: Role; token: string; uses: number; max_uses: number | null; expires_at: string; revoked_at: string | null; invited_by: string | null };

export function CompanyView() {
  const { me, company, members, profiles, reload, showMember } = useChat();
  const admin = isAdmin(me);
  const owner = me.role === "owner";
  const [form, setForm] = useState<Company>(company!);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [requests, setRequests] = useState<{ user_id: string; full_name: string; username: string; email: string; created_at: string }[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const [link, setLink] = useState({ role: "member", days: "7", max: "" });
  const [notice, setNotice] = useState("");

  // Bumped after each change so the admin lists below refetch
  const [tick, setTick] = useState(0);
  const companyId = company?.id;

  useEffect(() => {
    if (!admin || !companyId) return;
    Promise.all([
      supabase.from("company_invites").select("*").eq("company_id", companyId).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
      supabase.rpc("pending_join_requests"),
      supabase.from("company_domains").select("domain").eq("company_id", companyId),
    ]).then(([{ data: inv }, { data: req }, { data: dom }]) => {
      setInvites(inv ?? []);
      setRequests(req ?? []);
      setDomains((dom ?? []).map((d) => d.domain));
    });
  }, [companyId, admin, tick]);

  if (!company) return null;
  const done = async (error: { message: string } | null, ok: string) => {
    setNotice(error ? error.message : ok);
    if (!error) {
      await reload();
      setTick((t) => t + 1);
    }
  };
  const set = (k: keyof Company) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const active = Object.values(members).filter((m) => m.status === "active");
  const ownerProfile = profiles[company.owner_id ?? ""];

  return (
    <ViewShell icon="users" title="Company" subtitle={company.name}>
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        {notice && <div className="tm-fade rounded-xl bg-tm-blue-light px-4 py-2 text-sm text-tm-blue-dark">{notice}</div>}
        <Card title="Company details">
          <div className="flex items-center gap-4">
            <CompanyLogo company={company} size={64} />
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">{company.name}</div>
              <div className="text-sm text-zinc-500">@{company.handle} ·{active.length} members</div>
            </div>
          </div>
          {company.description && <p className="text-sm">{company.description}</p>}
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
            {(
              [
                ["Owner", ownerProfile ? <button className="text-tm-blue hover:underline" onClick={() => showMember(ownerProfile.id)}>{displayName(ownerProfile)}</button> : "–"],
                ["Admins", active.filter((m) => m.role === "admin").map((m) => displayName(profiles[m.user_id])).join(", ") || "–"],
                ["Email", company.email || "–"],
                ["Phone", company.phone || "–"],
                ["Website", company.website ? <a className="text-tm-blue hover:underline" href={company.website} target="_blank" rel="noreferrer">{company.website}</a> : "–"],
                ["Industry", company.industry || "–"],
                ["Size", company.size || "–"],
                ["Address", company.address || "–"],
                ["Created", fmtDate(company.created_at)],
              ] as [string, React.ReactNode][]
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-zinc-500">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {admin && (
          <Card title="Edit company profile">
            <div className="flex items-center gap-3">
              <CompanyLogo company={company} size={48} />
              <ImagePicker
                label="Upload logo"
                onFile={async (f) => {
                  const url = await uploadImage(`company/${company.id}`, f);
                  const { error } = await supabase.from("companies").update({ logo_url: url }).eq("id", company.id);
                  await done(error, "Logo updated");
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><input className={input} value={form.name} onChange={set("name")} /></Field>
              <Field label="URL handle"><input className={input} value={form.handle} onChange={set("handle")} disabled={!owner} /></Field>
              <Field label="Company email"><input className={input} type="email" value={form.email} onChange={set("email")} /></Field>
              <Field label="Phone"><input className={input} type="tel" value={form.phone} onChange={set("phone")} /></Field>
              <Field label="Industry"><input className={input} value={form.industry} onChange={set("industry")} /></Field>
              <Field label="Size">
                <select className={input} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}>
                  {["", "1–10", "11–50", "51–200", "201+"].map((s) => <option key={s} value={s}>{s || "–"}</option>)}
                </select>
              </Field>
              <Field label="Website"><input className={input} value={form.website} onChange={set("website")} placeholder="https://" /></Field>
              <Field label="Address"><input className={input} value={form.address} onChange={set("address")} /></Field>
            </div>
            <Field label="Description"><textarea className={`${input} h-20`} maxLength={500} value={form.description} onChange={set("description")} /></Field>
            <button
              className={btn}
              onClick={async () => {
                const { name, handle, email, phone, industry, size, website, address, description } = form;
                const { error } = await supabase.from("companies").update({ name, handle: handle.toLowerCase(), email, phone, industry, size, website, address, description }).eq("id", company.id);
                await done(error, "Company profile saved");
              }}
            >
              Save
            </button>
          </Card>
        )}

        {admin && (
          <Card title={`Join requests (${requests.length})`}>
            {requests.length === 0 && <p className="text-sm text-zinc-400">No pending requests</p>}
            {requests.map((r) => (
              <div key={r.user_id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">
                  <b>{r.full_name || `@${r.username}`}</b> {r.email} · {fmtDate(r.created_at)}
                </span>
                <button className={btnGhost} onClick={async () => done((await supabase.rpc("review_join", { p_user: r.user_id, p_approve: false })).error, "Request declined")}>Decline</button>
                <button className={btn} onClick={async () => done((await supabase.rpc("review_join", { p_user: r.user_id, p_approve: true })).error, "Member added")}>Approve</button>
              </div>
            ))}
          </Card>
        )}

        {admin && (
          <Card title="Invitations and invite links">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Role">
                <select className={input} value={link.role} onChange={(e) => setLink({ ...link, role: e.target.value })}>
                  <option value="member">Member</option>
                  <option value="guest">Guest</option>
                </select>
              </Field>
              <Field label="Expires after">
                <select className={input} value={link.days} onChange={(e) => setLink({ ...link, days: e.target.value })}>
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                </select>
              </Field>
              <Field label="Max uses">
                <input className={`${input} w-24`} type="number" min={1} value={link.max} onChange={(e) => setLink({ ...link, max: e.target.value })} placeholder="∞" />
              </Field>
              <button
                className={btn}
                onClick={async () => {
                  const { data, error } = await supabase.rpc("create_invite_link", { p_role: link.role, p_days: Number(link.days), p_max_uses: link.max ? Number(link.max) : null });
                  if (data) await navigator.clipboard.writeText(inviteUrl(data)).catch(() => {});
                  await done(error, "Invite link created and copied");
                }}
              >
                Create invite link
              </button>
            </div>
            <ul className="divide-y divide-tm-line text-sm">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-1.5">
                  <span className="flex-1 truncate">{i.email ?? "Invite link"} · {roleLabel[i.role]} · {i.uses}/{i.max_uses ?? "∞"} used · expires {fmtDate(i.expires_at)}</span>
                  <button className="text-tm-blue hover:underline" onClick={() => navigator.clipboard.writeText(inviteUrl(i.token))}>Copy</button>
                  <button className="text-red-600 hover:underline" onClick={async () => done((await supabase.rpc("revoke_invite", { p_id: i.id })).error, "Invite revoked")}>Revoke</button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {admin && (
          <Card title="Join settings">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={company.allow_join_requests} onChange={async (e) => done((await supabase.from("companies").update({ allow_join_requests: e.target.checked }).eq("id", company.id)).error, "Saved")} />
              People can find this company by its handle and request to join
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={company.members_can_invite} onChange={async (e) => done((await supabase.from("companies").update({ members_can_invite: e.target.checked }).eq("id", company.id)).error, "Saved")} />
              Members can invite people
            </label>
            <div className="space-y-2">
              <div className="text-sm text-zinc-500">Approved email domains: anyone signing up with these joins automatically{owner ? "" : " (owner only)"}</div>
              {domains.map((d) => (
                <div key={d} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">@{d}</span>
                  {owner && <button className="text-red-600 hover:underline" onClick={async () => done((await supabase.from("company_domains").delete().eq("domain", d)).error, "Domain removed")}>Remove</button>}
                </div>
              ))}
              {owner && (
                <form className="flex gap-2" onSubmit={async (e) => (e.preventDefault(), await done((await supabase.from("company_domains").insert({ domain: domain.trim().toLowerCase().replace(/^@/, ""), company_id: company.id })).error, "Domain added"), setDomain(""))}>
                  <input className={input} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" />
                  <button className={btnGhost}>Add domain</button>
                </form>
              )}
            </div>
          </Card>
        )}

        <Card title="Danger zone">
          <div className="flex flex-wrap gap-2">
            {!owner && (
              <button className={btnGhost} onClick={async () => confirm(`Leave ${company.name}?`) && done((await supabase.rpc("leave_company")).error, "You left the company")}>
                Leave company
              </button>
            )}
            {owner && (
              <button
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
                onClick={async () => (await askText("Delete company", `This deletes every channel, message and file in ${company.name}. Type the company handle to confirm.`, company.handle)) === company.handle && done((await supabase.rpc("delete_company")).error, "Company deleted")}
              >
                Delete company
              </button>
            )}
            {owner && <p className="text-xs text-zinc-500">To leave, first transfer ownership from a member&apos;s details card.</p>}
          </div>
        </Card>
      </div>
    </ViewShell>
  );
}
