import { memo, useEffect, useState } from "react";
import { Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { supabase, displayName, type Attachment, type Message, type Reaction } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { toggleSaved, useSavedIds } from "@/lib/saved";
import { WEB_URL } from "@/lib/supabase";
import { timeOf } from "@/lib/format";
import Body from "./Body";
import BlockKit, { Unfurl, type Block } from "./BlockKit";
import EmojiPicker from "./EmojiPicker";
import { Avatar, Button, C } from "./ui";

const QUICK = ["👍", "❤️", "😂", "🎉", "👀", "✅"];

type Props = { msg: Message; grouped: boolean; inThread: boolean; reactions: Reaction[]; onReact: (emoji: string) => void };

export const callLength = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
};

function MessageRow({ msg, grouped, inThread, reactions, onReact }: Props) {
  const { uid, profiles, markUnread } = useChat();
  const saved = useSavedIds()?.has(msg.id);
  const [sheet, setSheet] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const mine = msg.user_id === uid && !msg.bot_name;
  const callLog = msg.blocks?.find((b) => b.type === "call");
  const firstLink = msg.body.match(/https?:\/\/[^\s<>)]+/)?.[0];
  const openThread = () => router.push(`/t/${msg.id}?c=${msg.channel_id}`);

  const act = (fn: () => void) => () => {
    setSheet(false);
    fn();
  };
  const remove = () =>
    Alert.alert("Delete message?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => supabase.from("messages").update({ deleted_at: new Date().toISOString(), body: "", attachments: [] }).eq("id", msg.id).then() },
    ]);
  const pin = async () => {
    const { error } = await supabase.rpc("toggle_pin", { p_id: msg.id });
    if (error) Alert.alert(`Couldn't ${msg.pinned_at ? "unpin" : "pin"}`, error.message);
  };
  const link = () => Clipboard.setStringAsync(`${WEB_URL}/app?c=${msg.channel_id}&m=${msg.parent_id && !msg.also_in_channel ? msg.parent_id : msg.id}`);

  const groups = reactions.reduce<Record<string, string[]>>((g, r) => ({ ...g, [r.emoji]: [...(g[r.emoji] ?? []), r.user_id] }), {});

  return (
    <Pressable onLongPress={() => !msg.deleted_at && setSheet(true)} delayLongPress={300} style={[s.row, grouped && { paddingTop: 2 }, msg.pinned_at && s.pinned]}>
      <Pressable style={{ width: 36 }} disabled={grouped || !!msg.bot_name} onPress={() => router.push(`/member/${msg.user_id}`)}>
        {!grouped && <Avatar p={profiles[msg.user_id]} />}
      </Pressable>
      <View style={{ flex: 1 }}>
        {msg.pinned_at && <Text style={s.pinLabel}>📌 Pinned</Text>}
        {!grouped && (
          <Text style={s.name}>
            {msg.bot_name ?? displayName(profiles[msg.user_id])}
            {msg.bot_name && <Text style={s.app}> APP</Text>} <Text style={s.time}>{timeOf(msg.created_at)}</Text>
          </Text>
        )}
        {msg.deleted_at ? (
          <Text style={s.deleted}>This message was deleted.</Text>
        ) : callLog ? (
          <Text style={s.time}>📞 Meet ended · {callLength(callLog.duration ?? 0)}</Text>
        ) : (
          <>
            {!!msg.body && <Body text={msg.body} />}
            {msg.edited_at && <Text style={s.time}>(edited)</Text>}
            {msg.blocks && msg.bot_name && <BlockKit blocks={msg.blocks as unknown as Block[]} />}
            {firstLink && <Unfurl url={firstLink} />}
            {msg.attachments?.map((a) => <AttachmentView key={a.path} a={a} />)}
          </>
        )}
        {!!reactions.length && (
          <View style={s.chips}>
            {Object.entries(groups).map(([e, users]) => (
              <Pressable key={e} onPress={() => onReact(e)} style={[s.chip, users.includes(uid) && s.chipMine]}>
                <Text>
                  {e} {users.length}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {!inThread && msg.reply_count > 0 && (
          <Pressable onPress={openThread}>
            <Text style={s.replies}>
              {msg.reply_count} {msg.reply_count === 1 ? "reply" : "replies"}
            </Text>
          </Pressable>
        )}
      </View>

      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <Pressable style={s.backdrop} onPress={() => setSheet(false)} />
        <View style={s.sheet}>
          <View style={s.quick}>
            {QUICK.map((e) => (
              <Pressable key={e} onPress={act(() => onReact(e))} style={s.quickBtn}>
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Pressable>
            ))}
            <Pressable onPress={act(() => setEmoji(true))} style={s.quickBtn}>
              <Text style={{ fontSize: 22 }}>＋</Text>
            </Pressable>
          </View>
          {!inThread && <Item text="Reply in thread" onPress={act(openThread)} />}
          <Item text="Copy text" onPress={act(() => Clipboard.setStringAsync(msg.body))} />
          <Item text="Copy link" onPress={act(link)} />
          <Item text={saved ? "Remove from saved" : "Save for later"} onPress={act(() => toggleSaved(msg.id))} />
          <Item text={msg.pinned_at ? "Unpin from conversation" : "Pin to conversation"} onPress={act(pin)} />
          {!inThread && <Item text="Mark unread" onPress={act(() => markUnread(msg))} />}
          {mine && <Item text="Edit message" onPress={act(() => setEditing(true))} />}
          {mine && <Item text="Delete message" danger onPress={act(remove)} />}
        </View>
      </Modal>
      <EmojiPicker visible={emoji} onClose={() => setEmoji(false)} onPick={onReact} />
      {editing && <EditMessage msg={msg} onClose={() => setEditing(false)} />}
    </Pressable>
  );
}

export default memo(MessageRow);

const Item = ({ text, onPress, danger }: { text: string; onPress: () => void; danger?: boolean }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.item, pressed && { backgroundColor: "#f4f4f4" }]}>
    <Text style={{ fontSize: 16, color: danger ? C.red : C.text }}>{text}</Text>
  </Pressable>
);

function EditMessage({ msg, onClose }: { msg: Message; onClose: () => void }) {
  const [text, setText] = useState(msg.body);
  const save = async () => {
    const body = text.trim();
    if (body && body !== msg.body) await supabase.from("messages").update({ body, edited_at: new Date().toISOString() }).eq("id", msg.id);
    onClose();
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.center}>
        <View style={s.dialog}>
          <Text style={{ fontWeight: "800", fontSize: 17 }}>Edit message</Text>
          <TextInput style={s.input} multiline autoFocus value={text} onChangeText={setText} />
          <Button title="Save" onPress={save} />
          <Pressable onPress={onClose}>
            <Text style={{ textAlign: "center", color: C.muted, padding: 6 }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// Images show inline; other files open in the browser. Both go through a short-lived signed URL (private bucket).
function AttachmentView({ a }: { a: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const image = a.type.startsWith("image/");
  useEffect(() => {
    supabase.storage.from("attachments").createSignedUrl(a.path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [a.path]);
  if (image && url)
    return (
      <Pressable onPress={() => Linking.openURL(url)}>
        <Image source={{ uri: url }} style={s.image} resizeMode="cover" />
      </Pressable>
    );
  if (a.type.startsWith("audio/") && url) return <AudioClip url={url} a={a} />;
  const icon = a.type.startsWith("video/") ? "🎬" : "📎";
  return (
    <Pressable onPress={() => url && Linking.openURL(url)} style={s.file}>
      <Text style={{ color: C.blue }} numberOfLines={1}>
        {icon} {a.name}
      </Text>
    </Pressable>
  );
}

// Voice clips play inline
function AudioClip({ url, a }: { url: string; a: Attachment & { duration?: number } }) {
  const player = useAudioPlayer(url);
  const st = useAudioPlayerStatus(player);
  const total = st.duration || a.duration || 0;
  const toggle = () => {
    if (st.playing) return player.pause();
    if (total && st.currentTime >= total - 0.1) player.seekTo(0);
    player.play();
  };
  return (
    <Pressable onPress={toggle} style={[s.file, { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start" }]}>
      <Text style={{ fontSize: 18 }}>{st.playing ? "⏸" : "▶️"}</Text>
      <Text style={{ color: C.text }}>🎙 {clockOf(st.playing || st.currentTime ? st.currentTime : total)}</Text>
    </Pressable>
  );
}

const clockOf = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 },
  pinned: { backgroundColor: "#fef9ec" },
  pinLabel: { fontSize: 12, color: "#a27200", fontWeight: "600" },
  name: { fontWeight: "800", color: C.text, fontSize: 15 },
  app: { fontSize: 10, color: C.muted, fontWeight: "700" },
  time: { fontWeight: "400", color: C.muted, fontSize: 12 },
  deleted: { fontStyle: "italic", color: C.muted },
  replies: { color: C.blue, fontWeight: "700", marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: "#f8f8f8" },
  chipMine: { borderColor: C.blue, backgroundColor: "#e8f5fa" },
  image: { width: 220, height: 160, borderRadius: 8, marginTop: 4, backgroundColor: "#eee" },
  file: { marginTop: 4, padding: 8, borderWidth: 1, borderColor: C.line, borderRadius: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 30 },
  quick: { flexDirection: "row", justifyContent: "space-around", padding: 12, borderBottomWidth: 1, borderColor: C.line },
  quickBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#f4f4f4", alignItems: "center", justifyContent: "center" },
  item: { paddingHorizontal: 20, paddingVertical: 14 },
  center: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, fontSize: 15, minHeight: 80, maxHeight: 200, textAlignVertical: "top" },
});
