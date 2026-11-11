import { useEffect, useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { WEB_URL } from "@/lib/supabase";
import Body from "./Body";
import { C } from "./ui";

type T = { type: "plain_text" | "mrkdwn"; text: string };
// The Block Kit subset bots post (src/lib/supabase.ts Block); unknown types are skipped
export type Block =
  | { type: "header"; text: T }
  | { type: "section"; text?: T; fields?: T[]; accessory?: { type: "image"; image_url: string; alt_text?: string } }
  | { type: "divider" }
  | { type: "context"; elements: (T | { type: "image"; image_url: string; alt_text?: string })[] }
  | { type: "image"; image_url: string; alt_text?: string; title?: T }
  | { type: "actions"; elements: { type: "button"; text: T; url?: string; style?: "primary" | "danger" }[] }
  | { type: "call"; duration?: number; people?: string[] };

const safe = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);
const Txt = ({ t }: { t?: T }) => (t ? t.type === "mrkdwn" ? <Body text={t.text ?? ""} /> : <Text style={{ fontSize: 15 }}>{t.text}</Text> : null);

export default function BlockKit({ blocks }: { blocks: Block[] }) {
  return (
    <View style={{ borderLeftWidth: 4, borderColor: C.line, paddingLeft: 10, gap: 8, marginTop: 4 }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "header":
            return (
              <Text key={i} style={{ fontSize: 18, fontWeight: "800" }}>
                {b.text?.text}
              </Text>
            );
          case "divider":
            return <View key={i} style={{ height: 1, backgroundColor: C.line }} />;
          case "section":
            return (
              <View key={i} style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt t={b.text} />
                  {b.fields && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                      {b.fields.map((f, j) => (
                        <View key={j} style={{ width: "50%", paddingRight: 8 }}>
                          <Txt t={f} />
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                {safe(b.accessory?.image_url) && <Image source={{ uri: safe(b.accessory?.image_url) }} style={{ width: 72, height: 72, borderRadius: 8 }} />}
              </View>
            );
          case "context":
            return (
              <View key={i} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                {b.elements.map((e, j) =>
                  e.type === "image" ? (
                    safe(e.image_url) && <Image key={j} source={{ uri: safe(e.image_url) }} style={{ width: 16, height: 16, borderRadius: 3 }} />
                  ) : (
                    <Text key={j} style={{ color: C.muted, fontSize: 12 }}>
                      {e.text}
                    </Text>
                  ),
                )}
              </View>
            );
          case "image":
            return safe(b.image_url) ? (
              <View key={i} style={{ gap: 4 }}>
                {b.title && <Text style={{ color: C.muted }}>{b.title.text}</Text>}
                <Image source={{ uri: safe(b.image_url) }} style={{ width: "100%", height: 200, borderRadius: 8 }} resizeMode="contain" />
              </View>
            ) : null;
          case "actions":
            return (
              <View key={i} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {b.elements.map((e, j) => (
                  <Pressable
                    key={j}
                    disabled={!safe(e.url)}
                    onPress={() => Linking.openURL(safe(e.url)!)}
                    style={{ borderWidth: 1, borderColor: e.style === "primary" ? C.green : e.style === "danger" ? "#f3a3b8" : C.line, backgroundColor: e.style === "primary" ? C.green : "#fff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                  >
                    <Text style={{ fontWeight: "600", color: e.style === "primary" ? "#fff" : e.style === "danger" ? C.red : C.text }}>{e.text?.text}</Text>
                  </Pressable>
                ))}
              </View>
            );
          default:
            return null;
        }
      })}
    </View>
  );
}

// Link preview for a message's first URL, from the web app's /api/unfurl (cached per URL)
type Preview = { title: string; description?: string; image: string | null; site: string } | null;
const cache = new Map<string, Promise<Preview>>();
export function Unfurl({ url }: { url: string }) {
  const [data, setData] = useState<Preview>(null);
  useEffect(() => {
    if (!cache.has(url)) cache.set(url, fetch(`${WEB_URL}/api/unfurl?url=${encodeURIComponent(url)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    let live = true;
    cache.get(url)!.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [url]);
  if (!data) return null;
  return (
    <Pressable onPress={() => Linking.openURL(url)} style={{ borderLeftWidth: 4, borderColor: C.line, paddingLeft: 10, marginTop: 6, gap: 2 }}>
      <Text style={{ color: C.muted, fontSize: 12 }}>{data.site}</Text>
      <Text style={{ color: C.blue, fontWeight: "700" }}>{data.title}</Text>
      {!!data.description && (
        <Text numberOfLines={3} style={{ color: "#555" }}>
          {data.description}
        </Text>
      )}
      {data.image && <Image source={{ uri: data.image }} style={{ width: 240, height: 130, borderRadius: 8, marginTop: 4 }} resizeMode="cover" />}
    </Pressable>
  );
}
