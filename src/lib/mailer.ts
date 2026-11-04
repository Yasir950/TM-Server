// Server-only: imported by API routes, never by client components
import nodemailer, { type Transporter } from "nodemailer";
import { APP_NAME } from "@/lib/brand";

// One place that sends the app's own emails (contact form, upgrade requests, task notifications).
// SMTP_USER + SMTP_PASS set (e.g. a Gmail address and its app password): sends over SMTP, no domain needed.
// Otherwise falls back to Resend (RESEND_API_KEY), which needs a verified domain to reach anyone but the account owner.

export type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string };

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS?.replace(/\s+/g, ""); // Google shows app passwords as "abcd efgh ijkl mnop"

let transport: Transporter | null = null;
function smtp() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transport;
}

// Gmail rewrites any other From address to the signed-in account, so default to it
function sender(fallback?: string) {
  if (SMTP_USER && SMTP_PASS) return process.env.EMAIL_FROM_SMTP || `${APP_NAME} <${SMTP_USER}>`;
  return fallback || process.env.EMAIL_FROM || process.env.CONTACT_FROM || `${APP_NAME} <onboarding@resend.dev>`;
}

export const mailConfigured = () => !!(SMTP_USER && SMTP_PASS) || !!process.env.RESEND_API_KEY;

/** Sends one email; returns true when the provider accepted it. Never throws. */
export async function sendMail(mail: Mail, from?: string): Promise<boolean> {
  const sentFrom = sender(from);
  if (SMTP_USER && SMTP_PASS) {
    try {
      await smtp().sendMail({ from: sentFrom, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, replyTo: mail.replyTo });
      return true;
    } catch (e) {
      console.error("mail: SMTP failed", e instanceof Error ? e.message : e);
      return false;
    }
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("mail: neither SMTP_USER/SMTP_PASS nor RESEND_API_KEY is set, email not sent");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sentFrom, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, reply_to: mail.replyTo }),
    });
    if (!res.ok) console.error("mail: Resend failed", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (e) {
    console.error("mail: Resend request failed", e instanceof Error ? e.message : e);
    return false;
  }
}
