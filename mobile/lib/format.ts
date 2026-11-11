// Same rules as src/lib/format.ts plainText; the mobile app shows message bodies as plain text for now
export const plainText = (body: string) =>
  body
    .replace(/```/g, "")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(^|[\s(])([*_~])([^*_~\n]+)\2/g, "$1$3")
    .replace(/^(&gt;|>) ?/gm, "")
    .replace(/\s+/g, " ")
    .trim();

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function dayLabel(iso: string) {
  const d = new Date(iso).toDateString();
  const now = new Date();
  if (d === now.toDateString()) return "Today";
  now.setDate(now.getDate() - 1);
  if (d === now.toDateString()) return "Yesterday";
  return new Date(iso).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

// Channel names: lowercase, letters/digits/-/_ only, spaces to dashes
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_\s-]/g, "").trim().replace(/\s+/g, "-");

// Expands the body's mentions for sending: @username → user ids, as the web composer does
export const mentionIds = (body: string, byUsername: Map<string, string>) =>
  [...new Set([...body.matchAll(/(?:^|\s)@([\w.-]+)/g)].map((m) => byUsername.get(m[1].toLowerCase())).filter(Boolean) as string[])];
