"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

const field =
  "w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-[15px] outline-none transition focus:border-tm-blue focus:ring-4 focus:ring-tm-blue/10";
const label = "mb-1.5 block text-sm font-medium text-zinc-800";

const topics: [string, string][] = [
  ["sales", "Enterprise plan"],
  ["general", "General question"],
];

// /contact?topic=enterprise (pricing page, nav) opens on the Enterprise topic
export function ContactFormFromUrl() {
  const topic = useSearchParams().get("topic");
  return <ContactForm initialKind={topic === "enterprise" ? "sales" : "general"} />;
}

// Posts to /api/contact, which saves the request and emails it to the team
export default function ContactForm({ initialKind = "general" }: { initialKind?: "sales" | "general" }) {
  const [f, setF] = useState({ kind: initialKind as string, name: "", email: "", company: "", team_size: "", message: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  if (state === "sent")
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-zinc-200 bg-white p-10 text-center shadow-sm">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-tm-green/15 text-2xl text-tm-green">✓</span>
        <h2 className="mt-5 text-2xl font-bold">Thanks, {f.name.split(" ")[0]}!</h2>
        <p className="mt-2 max-w-sm text-zinc-600">We got your message and will reply to {f.email} soon.</p>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-5 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
      <div>
        <span className={label}>What can we help with?</span>
        <div className="grid grid-cols-2 gap-2">
          {topics.map(([k, t]) => (
            <label
              key={k}
              className={`flex items-center justify-center rounded-xl border px-3 py-2.5 text-sm font-medium transition ${f.kind === k ? "border-tm-blue bg-tm-blue-light text-tm-blue" : "border-zinc-300 text-zinc-700 hover:border-zinc-400"}`}
            >
              <input type="radio" name="kind" value={k} checked={f.kind === k} onChange={set("kind")} className="sr-only" />
              {t}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="c-name">Your name</label>
          <input id="c-name" className={field} value={f.name} onChange={set("name")} autoComplete="name" required maxLength={120} />
        </div>
        <div>
          <label className={label} htmlFor="c-email">Work email</label>
          <input id="c-email" className={field} type="email" value={f.email} onChange={set("email")} autoComplete="email" required maxLength={200} />
        </div>
        <div>
          <label className={label} htmlFor="c-company">Company</label>
          <input id="c-company" className={field} value={f.company} onChange={set("company")} autoComplete="organization" maxLength={200} />
        </div>
        <div>
          <label className={label} htmlFor="c-size">Team size</label>
          <select id="c-size" className={field} value={f.team_size} onChange={set("team_size")}>
            <option value="">Select…</option>
            {["1–10", "11–50", "51–250", "251–1,000", "1,000+"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={label} htmlFor="c-msg">How can we help?</label>
        <textarea
          id="c-msg"
          className={`${field} min-h-32 resize-y`}
          value={f.message}
          onChange={set("message")}
          maxLength={5000}
          required={f.kind === "general"}
          placeholder={f.kind === "sales" ? "Tell us about your team and what you need from an Enterprise plan" : ""}
        />
      </div>
      {/* Honeypot: hidden from people, filled by bots */}
      <input className="hidden" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} aria-hidden />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        className="w-full rounded-xl bg-tm-blue px-5 py-3.5 text-base font-semibold text-white transition hover:bg-tm-blue-dark active:scale-[0.99] disabled:opacity-60"
        disabled={state === "sending"}
      >
        {state === "sending" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
