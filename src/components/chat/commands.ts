import { supabase, type Channel, type Profile } from "@/lib/supabase";

export type CommandCtx = {
  me: Profile;
  channel?: Channel;
  profiles: Record<string, Profile>;
  reload: () => Promise<void>;
  openReminders: () => void;
};
// body: send this as the message instead; notice: show it only to the sender
export type CommandResult = { body?: string; notice?: string };

export const COMMANDS: [string, string][] = [
  ["/remind", "me in 20m <text> · me at 15:30 <text> · me tomorrow <text>"],
  ["/reminders", "List your reminders"],
  ["/status", "<emoji> <text> · clear"],
  ["/dnd", "30m · 2h · off"],
  ["/topic", "<text>"],
  ["/invite", "@user"],
  ["/leave", "Leave this channel"],
  ["/me", "<action>"],
  ["/shrug", "<text>"],
  ["/summarize", "AI summary of recent messages here"],
];

const fail = (notice: string): never => {
  throw new Error(notice);
};

// "20m", "2h", "1.5 hours", "3 days" -> milliseconds
export function parseDuration(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)$/i.exec(s.trim());
  if (!m) return null;
  const unit = m[2][0].toLowerCase();
  return Number(m[1]) * (unit === "m" ? 60_000 : unit === "h" ? 3600_000 : 86400_000);
}

function parseWhen(s: string): { at: Date; rest: string } | null {
  let m = /^in\s+(\d+(?:\.\d+)?\s*[a-z]+)\s+([\s\S]+)$/i.exec(s);
  if (m) {
    const ms = parseDuration(m[1]);
    return ms ? { at: new Date(Date.now() + ms), rest: m[2] } : null;
  }
  m = /^at\s+(\d{1,2}):(\d{2})\s+([\s\S]+)$/i.exec(s);
  if (m) {
    const at = new Date();
    at.setHours(+m[1], +m[2], 0, 0);
    if (at <= new Date()) at.setDate(at.getDate() + 1);
    return { at, rest: m[3] };
  }
  m = /^tomorrow\s+([\s\S]+)$/i.exec(s);
  if (m) {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(9, 0, 0, 0);
    return { at, rest: m[1] };
  }
  return null;
}

const when = (d: Date) => d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export async function runCommand(input: string, ctx: CommandCtx): Promise<CommandResult | null> {
  const m = /^\/(\w+)\s*([\s\S]*)$/.exec(input);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const arg = m[2].trim();
  const { me, channel } = ctx;
  const room = () => (channel && channel.kind !== "dm" ? channel : fail(`/${cmd} only works in channels`));

  switch (cmd) {
    case "shrug":
      return { body: `${arg} ¯\\_(ツ)_/¯`.trim() };
    case "me":
      return arg ? { body: `_${arg}_` } : fail("Usage: /me <action>");
    case "remind": {
      const w = parseWhen(arg.replace(/^me\s+/i, "")) ?? fail("Usage: /remind me in 20m <text> · at 15:30 <text> · tomorrow <text>");
      const text = w.rest.replace(/^to\s+/i, "").trim();
      const { error } = await supabase.from("reminders").insert({ text, remind_at: w.at.toISOString() });
      if (error) throw error;
      return { notice: `⏰ I'll remind you “${text}” ${when(w.at)}` };
    }
    case "reminders":
      ctx.openReminders();
      return {};
    case "status": {
      if (arg.toLowerCase() === "clear") {
        await supabase.from("profiles").update({ status_emoji: "", status_text: "", status_expires_at: null }).eq("id", me.id);
        return { notice: "Status cleared" };
      }
      const [first, ...rest] = arg.split(/\s+/);
      const emoji = /\p{Extended_Pictographic}/u.test(first ?? "") ? first : "";
      const text = (emoji ? rest.join(" ") : arg).slice(0, 100);
      if (!emoji && !text) fail("Usage: /status <emoji> <text> · /status clear");
      await supabase.from("profiles").update({ status_emoji: emoji, status_text: text, status_expires_at: null }).eq("id", me.id);
      return { notice: `Status set to ${emoji} ${text}` };
    }
    case "dnd": {
      if (arg.toLowerCase() === "off") {
        await supabase.from("profiles").update({ dnd_until: null }).eq("id", me.id);
        return { notice: "🔔 Notifications resumed" };
      }
      const ms = parseDuration(arg || "1h") ?? fail("Usage: /dnd 30m · /dnd 2h · /dnd off");
      const until = new Date(Date.now() + ms);
      await supabase.from("profiles").update({ dnd_until: until.toISOString() }).eq("id", me.id);
      return { notice: `🌙 Notifications paused until ${when(until)}` };
    }
    case "topic": {
      const { error } = await supabase.from("channels").update({ topic: arg.slice(0, 250) }).eq("id", room().id);
      if (error) throw error;
      return { notice: arg ? "Topic updated" : "Topic cleared" };
    }
    case "invite": {
      const c = room();
      const names = [...arg.matchAll(/@?([\w.-]+)/g)].map((x) => x[1].toLowerCase());
      const ids = Object.values(ctx.profiles).filter((p) => names.includes(p.username.toLowerCase())).map((p) => p.id);
      if (!ids.length) fail("Usage: /invite @user [@user…]");
      const { error } = await supabase.from("channel_members").upsert(ids.map((user_id) => ({ channel_id: c.id, user_id })), { ignoreDuplicates: true });
      if (error) throw error;
      return { notice: `Added ${ids.length} ${ids.length === 1 ? "person" : "people"} to #${c.name}` };
    }
    case "leave": {
      const c = room();
      await supabase.from("channel_members").delete().match({ channel_id: c.id, user_id: me.id });
      await ctx.reload();
      return {};
    }
    case "summarize": {
      if (!channel) fail("/summarize only works in a conversation");
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token}` },
        body: JSON.stringify({ channelId: channel!.id }),
      });
      const out = await res.json().catch(() => ({ error: "Summary failed" }));
      return out.summary ? { notice: `✨ ${out.summary}` } : fail(out.error ?? "Summary failed");
    }
    default:
      return fail(`Unknown command /${cmd}. Type / to see available commands.`);
  }
}
