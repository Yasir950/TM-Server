import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/brand";

// Contact form (public site) and plan upgrade requests (Admin > Plan).
// Every request is saved to public.contact_requests, then emailed through Resend (RESEND_API_KEY) to CONTACT_EMAIL.
// Without a Resend key the request is still saved and super admins see it in the app.

const TO = process.env.CONTACT_EMAIL || "368yasir@gmail.com";
// Resend's shared sender only delivers to the Resend account's own address; verify a domain to use your own
const FROM = process.env.CONTACT_FROM || `${APP_NAME} <onboarding@resend.dev>`;

const KINDS = ["sales", "upgrade", "general"] as const;
type Kind = (typeof KINDS)[number];
const LABEL: Record<Kind, string> = { sales: "Enterprise / sales inquiry", upgrade: "Upgrade request", general: "Contact form" };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function sendEmail(subject: string, text: string, replyTo: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("contact: RESEND_API_KEY is not set, request saved but not emailed");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [TO], reply_to: replyTo, subject, text }),
  });
  if (!res.ok) console.error("contact: Resend failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
  // Bots fill every field; people never see this one
  if (str(body.website, 200)) return Response.json({ ok: true });

  const kind = (KINDS as readonly string[]).includes(body.kind as string) ? (body.kind as Kind) : "general";
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });

  // From inside the app: an admin asking to move their company to another plan
  if (token && kind === "upgrade") {
    const plan = body.plan === "enterprise" ? "enterprise" : "pro";
    const note = str(body.message, 2000);
    const { data, error } = await supabase.rpc("request_upgrade", { p_plan: plan, p_message: note });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const info = data as { name: string; email: string; company: string; handle: string; plan: string; members: number };
    const emailed = await sendEmail(
      `[${APP_NAME}] ${info.company} wants ${plan === "pro" ? "Pro" : "Enterprise"}`,
      [
        `${info.name} (${info.email}) asked to move ${info.company} (@${info.handle}) from ${info.plan} to ${plan}.`,
        `Active members: ${info.members}`,
        note && `\nMessage:\n${note}`,
        `\nSwitch the plan in ${APP_NAME}: Super admin > Companies.`,
      ]
        .filter(Boolean)
        .join("\n"),
      info.email,
    );
    return Response.json({ ok: true, emailed });
  }

  // Public contact form
  const row = {
    kind,
    name: str(body.name, 120),
    email: str(body.email, 200),
    company: str(body.company, 200),
    team_size: str(body.team_size, 40),
    message: str(body.message, 5000),
  };
  if (!row.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
    return Response.json({ error: "Please enter your name and a valid email address." }, { status: 400 });
  }
  if (!row.message && kind === "general") return Response.json({ error: "Please write a message." }, { status: 400 });

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  // The saved copy is a backup for the email: only the spam brake stops the request,
  // anything else (e.g. the plans migration not applied yet) is logged and the email still goes out
  const { error } = await anon.from("contact_requests").insert(row);
  if (error && /too many requests/i.test(error.message)) return Response.json({ error: error.message }, { status: 429 });
  if (error) console.error("contact: could not save request", error.message);

  const emailed = await sendEmail(
    `[${APP_NAME}] ${LABEL[kind]} from ${row.name}${row.company ? `, ${row.company}` : ""}`,
    [
      `Name: ${row.name}`,
      `Email: ${row.email}`,
      row.company && `Company: ${row.company}`,
      row.team_size && `Team size: ${row.team_size}`,
      `Topic: ${LABEL[kind]}`,
      row.message && `\n${row.message}`,
    ]
      .filter(Boolean)
      .join("\n"),
    row.email,
  );
  if (error && !emailed) return Response.json({ error: "Your message couldn't be sent. Please try again later." }, { status: 503 });
  return Response.json({ ok: true, emailed });
}
