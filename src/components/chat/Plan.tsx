"use client";

import { useEffect, useState } from "react";
import { supabase, fmtBytes, type Plan } from "@/lib/supabase";
import { PRO_PRICE } from "@/lib/plans";
import { btn, btnGhost, input } from "../ui";
import { Icon } from "../icons";
import { useChat } from "./store";

type Usage = { members: number; storage_bytes: number; webhooks: number; workflows: number };

const features: [keyof Plan, string][] = [
  ["guests", "Guest accounts"],
  ["ai_summaries", "AI summaries"],
  ["events_api", "Events API"],
  ["dlp", "Data loss prevention"],
  ["audit_log", "Audit log"],
  ["custom_retention", "Custom message retention"],
];

function Meter({ label, used, limit, fmt = (n: number) => n.toLocaleString() }: { label: string; used: number; limit: number | null; fmt?: (n: number) => string }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-zinc-600">{label}</span>
        <span className="tabular-nums text-zinc-500">
          {fmt(used)} {limit ? `of ${fmt(limit)}` : "· unlimited"}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-tm-surface">
        {limit ? <div className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-tm-blue"}`} style={{ width: `${Math.max(pct, used ? 2 : 0)}%` }} /> : null}
      </div>
    </div>
  );
}

// A small "available on Pro" card used in place of locked admin tools
export function Locked({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-dashed border-tm-line bg-tm-surface/60 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-500">
        {title}
        <span className="rounded-md bg-tm-blue px-1.5 py-0.5 text-[10px] font-semibold text-white">PRO</span>
      </h2>
      <p className="mt-1 text-sm text-zinc-500">{children}</p>
    </section>
  );
}

// Admin > Plan: the company's plan, how much of it is used, and a way to ask for an upgrade
export default function PlanCard({ notify }: { notify: (s: string) => void }) {
  const { company, plan, reload } = useChat();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc("company_usage").then(({ data }) => setUsage(data as Usage));
  }, []);

  if (!company || !plan) return null;
  const next = plan.id === "free" ? "pro" : plan.id === "pro" ? "enterprise" : null;

  const request = async () => {
    setBusy(true);
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token}` },
      body: JSON.stringify({ kind: "upgrade", plan: next, message: note }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return notify(out.error ?? "The request could not be sent");
    setAsking(false);
    setNote("");
    notify(next === "pro" ? "Upgrade requested. We'll confirm by email and switch your company to Pro." : "Thanks! Our team will contact you about Enterprise.");
    reload();
  };

  return (
    <section className="rounded-2xl border border-tm-line bg-white p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-zinc-500">Plan</h2>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{plan.name}</span>
            <span className="text-sm text-zinc-500">
              {plan.price_cents === null ? "custom pricing" : plan.price_cents === 0 ? "free" : `$${plan.price_cents / 100} / month`}
            </span>
          </p>
          {company.upgrade_requested_at && (
            <p className="mt-1 text-xs text-tm-blue-dark">
              Upgrade requested {new Date(company.upgrade_requested_at).toLocaleDateString(undefined, { dateStyle: "medium" })}. We&apos;ll be in touch by email.
            </p>
          )}
        </div>
        {next && !asking && (
          <button className={btn} onClick={() => setAsking(true)}>
            {next === "pro" ? `Upgrade to Pro · $${PRO_PRICE}/month` : "Talk to us about Enterprise"}
          </button>
        )}
        <a href="/pricing" target="_blank" rel="noreferrer" className={btnGhost}>
          Compare plans
        </a>
      </div>

      {asking && (
        <div className="tm-fade mt-4 rounded-xl bg-tm-surface p-4">
          <p className="text-sm text-zinc-600">
            {next === "pro"
              ? `Pro is $${PRO_PRICE} a month for ${company.name}: up to 250 members, unlimited history, 25 GB storage, group calls, AI summaries and every admin tool. We'll email you to confirm and switch your company over.`
              : "Tell us what you need and we'll reach out about custom limits and pricing."}
          </p>
          <textarea className={`${input} mt-3 min-h-20`} placeholder="Anything we should know? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          <div className="mt-3 flex gap-2">
            <button className={btn} onClick={request} disabled={busy}>
              {busy ? "Sending…" : "Send request"}
            </button>
            <button className={btnGhost} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Meter label="Members" used={usage?.members ?? 0} limit={plan.max_members} />
        <Meter label="File storage" used={usage?.storage_bytes ?? 0} limit={plan.storage_bytes} fmt={fmtBytes} />
        <Meter label="Webhooks" used={usage?.webhooks ?? 0} limit={plan.max_webhooks} />
        <Meter label="Workflows" used={usage?.workflows ?? 0} limit={plan.max_workflows} />
      </div>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <span className="text-zinc-600">
          History: <b className="font-medium">{plan.history_days ? `${plan.history_days} days` : "unlimited"}</b>
        </span>
        <span className="text-zinc-600">
          Calls: <b className="font-medium">{plan.max_call_participants === 2 ? "1:1" : `up to ${plan.max_call_participants ?? "∞"} people`}</b>
        </span>
        <span className="text-zinc-600">
          Largest file: <b className="font-medium">{plan.max_file_bytes ? fmtBytes(plan.max_file_bytes) : "no limit"}</b>
        </span>
        {features.map(([k, label]) => (
          <span key={k} className={`inline-flex items-center gap-1 ${plan[k] ? "text-zinc-700" : "text-zinc-400 line-through"}`}>
            {plan[k] && <Icon name="check" size={13} className="text-tm-green" />}
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
