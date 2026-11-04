import type { NextRequest } from "next/server";
import { APP_NAME } from "@/lib/brand";

// Called by email_to() in the database over pg_net, never by browsers:
// POST {"to": "...", "template": "task_assigned", "data": {...}} with X-Push-Secret matching PUSH_SECRET.
// Sends through Resend; onboarding@resend.dev only delivers to the Resend account's own address,
// so set EMAIL_FROM to an address on a domain verified at Resend.

const FROM = process.env.EMAIL_FROM || process.env.CONTACT_FROM || `${APP_NAME} <onboarding@resend.dev>`;

type TaskAssigned = {
  actor: string;
  assignee: string;
  key: string;
  title: string;
  description: string;
  project: string;
  company: string | null;
  type: string;
  priority: string;
  status: string;
  due_date: string | null;
  path: string;
  app_url: string;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
const due = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function taskAssigned(d: TaskAssigned) {
  // The database builds app links as /?…; the app lives at /app
  const url = `${d.app_url}${d.path.replace(/^\/(?=\?|$)/, "/app")}`;
  const subject = `${d.actor} assigned you ${d.key}: ${d.title}`;
  const rows: [string, string][] = [
    ["Project", d.company ? `${d.project} · ${d.company}` : d.project],
    ["Type", cap(d.type)],
    ["Priority", cap(d.priority)],
    ["Status", cap(d.status)],
    ...(d.due_date ? ([["Due", due(d.due_date)]] as [string, string][]) : []),
  ];
  const text = [
    `Hi ${d.assignee || "there"},`,
    "",
    `${d.actor} assigned you ${d.key}: ${d.title}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(d.description ? ["", d.description] : []),
    "",
    `Open the task: ${url}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f7f9fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #eceff4;border-radius:16px">
<tr><td style="padding:24px 28px 8px;font-size:14px;color:#6b7280">${esc(APP_NAME)}</td></tr>
<tr><td style="padding:0 28px;font-size:15px">${esc(d.actor)} assigned you a task</td></tr>
<tr><td style="padding:12px 28px 4px"><span style="font-size:12px;font-weight:600;color:#1c75bc">${esc(d.key)}</span>
<div style="font-size:20px;font-weight:600;margin-top:2px">${esc(d.title)}</div></td></tr>
<tr><td style="padding:12px 28px"><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#6b7280">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join("")}
</table></td></tr>
${d.description ? `<tr><td style="padding:4px 28px 12px;font-size:14px;color:#374151;white-space:pre-wrap">${esc(d.description.slice(0, 1000))}</td></tr>` : ""}
<tr><td style="padding:12px 28px 28px"><a href="${esc(url)}" style="display:inline-block;background:#1c75bc;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px">Open task</a></td></tr>
</table>
<p style="font-size:12px;color:#9ca3af;margin:16px 0 0">You're getting this because you were assigned a task in ${esc(APP_NAME)}.</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

export async function POST(req: NextRequest) {
  const secret = process.env.PUSH_SECRET;
  if (!secret || req.headers.get("x-push-secret") !== secret) return Response.json({ error: "forbidden" }, { status: 403 });
  const key = process.env.RESEND_API_KEY;
  if (!key) return Response.json({ error: "email_not_configured" }, { status: 503 });

  const { to, template, data } = (await req.json().catch(() => ({}))) as { to?: string; template?: string; data?: unknown };
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return Response.json({ error: "invalid_recipient" }, { status: 400 });
  if (template !== "task_assigned" || !data) return Response.json({ error: "unknown_template" }, { status: 400 });

  const mail = taskAssigned(data as TaskAssigned);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], ...mail }),
  });
  if (!res.ok) {
    console.error("email: Resend failed", res.status, await res.text().catch(() => ""));
    return Response.json({ error: "send_failed" }, { status: 502 });
  }
  return Response.json({ sent: 1 });
}
