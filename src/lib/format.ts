// Slack-style formatting: *bold* _italic_ ~strike~ `code` ```block``` > quote, - / 1. lists, [text](url) links,
// bare links, @mentions, #channels.
// Input is HTML-escaped before any markup is added, so the result is safe for dangerouslySetInnerHTML.

import type { JSONContent } from "@tiptap/react";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const linkAttrs = 'target="_blank" rel="noopener noreferrer" class="tm-link"';

function inline(s: string, usernames: Set<string>, channels: Set<string>) {
  // Code and links are swapped for placeholders so the emphasis rules can't reach inside them
  const stash: string[] = [];
  const keep = (html: string) => `\u0001${stash.push(html) - 1}\u0002`;
  return s
    .replace(/`([^`\n]+)`/g, (_, code) => keep(`<code class="tm-code">${code}</code>`))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => keep(`<a href="${url}" ${linkAttrs}>`) + text + keep("</a>"))
    .replace(/https?:\/\/[^\s\u0001\u0002]*[^\s\u0001\u0002.,;:!?)]/g, (url) => keep(`<a href="${url}" ${linkAttrs}>${url}</a>`))
    .replace(/(^|[\s(>*_~\u0002])\*([^*\n]+)\*/g, "$1<strong>$2</strong>")
    .replace(/(^|[\s(>*_~\u0002])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/(^|[\s(>*_~\u0002])~([^~\n]+)~/g, "$1<s>$2</s>")
    .replace(/(^|\s)@([a-z0-9_.-]+)/gi, (m, pre, name) =>
      usernames.has(name.toLowerCase()) || name === "channel" || name === "here"
        ? `${pre}<span class="tm-mention">@${name}</span>`
        : m,
    )
    .replace(/(^|\s)#([a-z0-9_-]+)/gi, (m, pre, name) =>
      channels.has(name.toLowerCase()) ? `${pre}<span class="tm-mention" data-channel="${name}">#${name}</span>` : m,
    )
    .replace(/\u0001(\d+)\u0002/g, (_, i) => stash[+i]);
}

type ListItem = { level: number; ordered: boolean; num: number; text: string };

// Nested <ul>/<ol> from flat items; each level may only go one deeper than the last
function listHtml(items: ListItem[], fmt: (s: string) => string) {
  let html = "";
  const stack: string[] = [];
  for (const it of items) {
    const tag = it.ordered ? "ol" : "ul";
    const level = Math.min(it.level, stack.length);
    while (stack.length > level + 1) html += `</li></${stack.pop()}>`;
    if (stack.length === level + 1 && stack[level] !== tag) html += `</li></${stack.pop()}>`;
    if (stack.length === level + 1) html += "</li>";
    else {
      stack.push(tag);
      html += `<${tag}${it.ordered && it.num !== 1 ? ` start="${it.num}"` : ""}>`;
    }
    html += `<li>${fmt(it.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop()}>`;
  return html;
}

const LIST_LINE = /^( *)(?:[-•]|(\d+)\.) (.*)$/;
const QUOTE_LINE = /^&gt;(?: |$)/;

// editor: emit the HTML the rich editor parses (one <p> per line) instead of display markup
function render(body: string, usernames: Set<string>, channels: Set<string>, editor: boolean) {
  const fmt = (s: string) => inline(s, usernames, channels);
  const parts = esc(body).split(/```/);
  let html = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const code = part.replace(/^\n/, "").replace(/\n$/, "");
      html += editor ? `<pre><code>${code}</code></pre>` : `<pre class="tm-pre">${code}</pre>`;
      return;
    }
    if (i > 0) part = part.replace(/^\n/, "");
    if (i < parts.length - 1) part = part.replace(/\n$/, "");
    if (!part) return;
    // Group consecutive lines of the same kind into one block
    const groups: { kind: "text" | "quote" | "list"; lines: string[] }[] = [];
    for (const line of part.split("\n")) {
      const kind = QUOTE_LINE.test(line) ? "quote" : LIST_LINE.test(line) ? "list" : "text";
      const last = groups[groups.length - 1];
      if (last?.kind === kind) last.lines.push(line);
      else groups.push({ kind, lines: [line] });
    }
    for (const g of groups) {
      if (g.kind === "list") {
        html += listHtml(
          g.lines.map((l) => {
            const [, sp, num, text] = LIST_LINE.exec(l)!;
            return { level: Math.floor(sp.length / 2), ordered: !!num, num: num ? +num : 1, text };
          }),
          editor ? (s) => `<p>${fmt(s)}</p>` : fmt,
        );
      } else if (g.kind === "quote") {
        const lines = g.lines.map((l) => fmt(l.replace(QUOTE_LINE, "")));
        html += editor
          ? `<blockquote>${lines.map((l) => `<p>${l}</p>`).join("")}</blockquote>`
          : `<blockquote class="tm-quote">${lines.join("<br/>")}</blockquote>`;
      } else {
        html += editor ? g.lines.map((l) => `<p>${fmt(l)}</p>`).join("") : g.lines.map(fmt).join("<br/>");
      }
    }
  });
  return html;
}

export const renderBody = (body: string, usernames: Set<string>, channels: Set<string>) => render(body, usernames, channels, false);

// mrkdwn -> HTML for loading a draft or an edit into the rich editor (mentions stay plain text there)
export const toEditorHtml = (body: string) => render(body, new Set(), new Set(), true);

// Rich editor document -> mrkdwn ----------------------------------------------------------------

const MARKS = ["link", "bold", "italic", "strike", "code"] as const;
const MARKER: Record<string, string> = { bold: "*", italic: "_", strike: "~", code: "`" };
type OpenMark = { type: string; href?: string };

const safeHref = (href?: string) => (href && /^https?:\/\//i.test(href) ? href : undefined);

function inlineMd(nodes: JSONContent[] = []) {
  let out = "";
  const stack: OpenMark[] = [];
  // Close marks down to depth n, keeping trailing spaces outside the markers so they still parse
  const close = (n: number) => {
    if (stack.length <= n) return;
    const ws = /\s*$/.exec(out)![0];
    out = out.slice(0, out.length - ws.length);
    while (stack.length > n) {
      const m = stack.pop()!;
      out += m.type === "link" ? `](${m.href})` : MARKER[m.type];
    }
    out += ws;
  };
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      close(0);
      out += "\n";
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const want = MARKS.flatMap((type): OpenMark[] => {
      const m = node.marks?.find((x) => x.type === type);
      if (!m) return [];
      if (type !== "link") return [{ type }];
      const href = safeHref(m.attrs?.href);
      // A bare URL renders as a link anyway
      return href && href !== node.text ? [{ type, href }] : [];
    });
    let k = 0;
    while (k < stack.length && k < want.length && stack[k].type === want[k].type && stack[k].href === want[k].href) k++;
    close(k);
    let text = node.text;
    if (want.length > k && text.trim()) {
      const lead = /^\s*/.exec(text)![0];
      out += lead;
      text = text.slice(lead.length);
      for (const m of want.slice(k)) {
        stack.push(m);
        out += m.type === "link" ? "[" : MARKER[m.type];
      }
    }
    out += text;
  }
  close(0);
  return out;
}

function blockMd(node: JSONContent): string[] {
  const kids = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return inlineMd(kids).split("\n");
    case "codeBlock":
      return ["```", ...kids.map((k) => k.text ?? "").join("").split("\n"), "```"];
    case "blockquote":
      return kids.flatMap(blockMd).map((l) => (l ? `> ${l}` : ">"));
    case "bulletList":
    case "orderedList":
      return kids.flatMap((li, i) => {
        const marker = node.type === "orderedList" ? `${(node.attrs?.start ?? 1) + i}. ` : "- ";
        const [first = "", ...rest] = (li.content ?? []).flatMap(blockMd);
        return [marker + first, ...rest.map((l) => `  ${l}`)];
      });
    default:
      return kids.length ? [inlineMd(kids)] : [];
  }
}

export const toMrkdwn = (doc: JSONContent) => (doc.content ?? []).flatMap(blockMd).join("\n").trim();

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

export const fileSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
