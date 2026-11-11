import { Fragment, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useChat } from "@/lib/store";
import { C } from "./ui";

// Native rendering of Slack-style mrkdwn, same rules as src/lib/format.ts renderBody:
// *bold* _italic_ ~strike~ `code` ```block``` > quote, - / 1. lists, [text](url), bare links, @mentions, #channels
export default function Body({ text }: { text: string }) {
  const { profiles, channels } = useChat();
  const users = new Set(Object.values(profiles).map((p) => p.username.toLowerCase()));
  const chans = new Set(Object.values(channels).map((c) => (c.name ?? "").toLowerCase()));
  const fmt = (s: string, k: string) => inline(s, k, users, chans);

  const out: ReactNode[] = [];
  text.split(/```/).forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(
        <Text key={`pre${i}`} style={s.pre} selectable>
          {part.replace(/^\n/, "").replace(/\n$/, "")}
        </Text>,
      );
      return;
    }
    part = part.replace(i > 0 ? /^\n/ : /^$/, "").replace(/\n$/, "");
    if (!part) return;
    // Consecutive lines of one kind make one block
    const groups: { kind: "text" | "quote" | "list"; lines: string[] }[] = [];
    for (const line of part.split("\n")) {
      const kind = /^>(?: |$)/.test(line) ? "quote" : LIST.test(line) ? "list" : "text";
      const last = groups[groups.length - 1];
      if (last?.kind === kind) last.lines.push(line);
      else groups.push({ kind, lines: [line] });
    }
    groups.forEach((g, j) => {
      const k = `${i}.${j}`;
      if (g.kind === "quote")
        out.push(
          <View key={k} style={s.quote}>
            <Text style={s.text}>{g.lines.map((l, n) => [n > 0 && "\n", ...fmt(l.replace(/^> ?/, ""), `${k}.${n}`)])}</Text>
          </View>,
        );
      else if (g.kind === "list")
        g.lines.forEach((l, n) => {
          const [, sp, num, body] = LIST.exec(l)!;
          out.push(
            <View key={`${k}.${n}`} style={{ flexDirection: "row", paddingLeft: 4 + Math.floor(sp.length / 2) * 16 }}>
              <Text style={[s.text, { width: 20 }]}>{num ? `${num}.` : "•"}</Text>
              <Text style={[s.text, { flex: 1 }]}>{fmt(body, `${k}.${n}`)}</Text>
            </View>,
          );
        });
      else out.push(<Text key={k} style={s.text} selectable>{g.lines.map((l, n) => [n > 0 && "\n", ...fmt(l, `${k}.${n}`)])}</Text>);
    });
  });
  return <View>{out}</View>;
}

const LIST = /^( *)(?:[-•]|(\d+)\.) (.*)$/;
// One token per alternative: code, [text](url), bare url, *bold*, _italic_, ~strike~, @mention, #channel
const TOKEN = /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]*[^\s.,;:!?)])|(?<=^|[\s(])\*([^*\n]+)\*|(?<=^|[\s(])_([^_\n]+)_|(?<=^|[\s(])~([^~\n]+)~|(?<=^|\s)@([a-z0-9_.-]+)|(?<=^|\s)#([a-z0-9_-]+)/gi;

function inline(s: string, key: string, users: Set<string>, chans: Set<string>): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    last = m.index! + m[0].length;
    const k = `${key}:${n++}`;
    const [, code, ltext, lurl, url, bold, ital, strike, at, hash] = m;
    if (code) out.push(<Text key={k} style={st.code}>{code}</Text>);
    else if (ltext) out.push(<Text key={k} style={st.link} onPress={() => Linking.openURL(lurl)}>{ltext}</Text>);
    else if (url) out.push(<Text key={k} style={st.link} onPress={() => Linking.openURL(url)}>{url}</Text>);
    else if (bold) out.push(<Text key={k} style={{ fontWeight: "700" }}>{inline(bold, k, users, chans)}</Text>);
    else if (ital) out.push(<Text key={k} style={{ fontStyle: "italic" }}>{inline(ital, k, users, chans)}</Text>);
    else if (strike) out.push(<Text key={k} style={{ textDecorationLine: "line-through" }}>{inline(strike, k, users, chans)}</Text>);
    else if (at) out.push(users.has(at.toLowerCase()) || at === "channel" || at === "here" ? <Text key={k} style={st.mention}>@{at}</Text> : <Fragment key={k}>{m[0]}</Fragment>);
    else if (hash) out.push(chans.has(hash.toLowerCase()) ? <Text key={k} style={st.mention}>#{hash}</Text> : <Fragment key={k}>{m[0]}</Fragment>);
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const st = StyleSheet.create({
  code: { fontFamily: "monospace", backgroundColor: "#f6f6f6", color: "#c01343", fontSize: 13 },
  link: { color: C.blue },
  mention: { color: C.blue, backgroundColor: "#e8f5fa", fontWeight: "600" },
});
const s = StyleSheet.create({
  text: { fontSize: 15, color: C.text, lineHeight: 21 },
  pre: { fontFamily: "monospace", fontSize: 13, backgroundColor: "#f8f8f8", borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 8, marginVertical: 4 },
  quote: { borderLeftWidth: 4, borderColor: "#ddd", paddingLeft: 10, marginVertical: 2 },
});
