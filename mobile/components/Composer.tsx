import { useEffect, useRef, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { randomUUID } from "expo-crypto";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { supabase, displayName, fmtBytes, type Attachment, type Message } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { mentionIds } from "@/lib/format";
import { COMMANDS, runCommand } from "@/lib/commands";
import { Avatar, C } from "./ui";
import { Icon } from "./Icon";

type Pending = { uri: string; name: string; type: string; size: number; duration?: number };
type Props = { channelId: string; parentId: string | null; onSent: (m: Message) => void; onTyping: () => void };

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export default function Composer({ channelId, parentId, onSent, onTyping }: Props) {
  const { me, profiles, channels, channelTitle, reload, plan } = useChat();
  const c = channels[channelId];
  const draftKey = `tm:draft:${channelId}:${parentId ?? ""}`;
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [files, setFiles] = useState<Pending[]>([]);
  const [alsoSend, setAlsoSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const input = useRef<TextInput>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder, 200);

  // Drafts survive leaving the conversation, like the web app's
  useEffect(() => {
    AsyncStorage.getItem(draftKey).then((d) => d && setText(d));
  }, [draftKey]);
  useEffect(() => {
    (text ? AsyncStorage.setItem(draftKey, text) : AsyncStorage.removeItem(draftKey)).catch(() => {});
  }, [text, draftKey]);

  // @mention autocomplete from the word being typed at the caret
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\w.-]*)$/.exec(before);
  const q = m?.[2].toLowerCase() ?? "";
  const suggestions = m
    ? [
        ...(c?.kind === "dm" ? [] : [{ username: "channel", label: "Notify everyone in this channel", id: "" }]).filter((g) => g.username.startsWith(q)),
        ...Object.values(profiles)
          .filter((p) => `${p.username} ${p.full_name}`.toLowerCase().includes(q))
          .map((p) => ({ username: p.username, label: displayName(p), id: p.id })),
      ].slice(0, 6)
    : [];
  const commands = /^\/\w*$/.test(text) ? COMMANDS.filter(([cmd]) => cmd.startsWith(text.toLowerCase())) : [];

  const pickMention = (username: string) => {
    const start = before.length - q.length;
    const next = `${text.slice(0, start)}${username} ${text.slice(caret)}`;
    setText(next);
    setCaret(start + username.length + 1);
  };

  const add = (assets: { uri: string; name?: string | null; fileName?: string | null; mimeType?: string | null; size?: number; fileSize?: number; duration?: number | null }[]) =>
    setFiles((f) => [
      ...f,
      ...assets.map((a) => ({
        uri: a.uri,
        name: a.name ?? a.fileName ?? a.uri.split("/").pop() ?? "file",
        type: a.mimeType ?? "application/octet-stream",
        size: a.size ?? a.fileSize ?? 0,
        // Video length from the picker comes in milliseconds
        duration: a.duration ? a.duration / 1000 : undefined,
      })),
    ]);

  async function attach() {
    const options = ["Photo or video library", "Take photo", "Record video clip", "File", "Cancel"];
    const run = async (i: number) => {
      if (i === 0) {
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, quality: 0.85 });
        if (!r.canceled) add(r.assets);
      } else if (i === 1 || i === 2) {
        if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) return Alert.alert("Camera access is off", "Allow it in Settings to take photos.");
        const r = await ImagePicker.launchCameraAsync({ mediaTypes: i === 1 ? ["images"] : ["videos"], quality: 0.85, videoMaxDuration: 300 });
        if (!r.canceled) add(r.assets);
      } else if (i === 3) {
        const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
        if (!r.canceled) add(r.assets);
      }
    };
    if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 4 }, run);
    else Alert.alert("Attach", undefined, [...options.slice(0, 4).map((text, i) => ({ text, onPress: () => run(i) })), { text: "Cancel", style: "cancel" as const }]);
  }

  // Voice clip: tap to record, tap again to attach it (the web app's Clips use the same attachment fields)
  async function toggleRecording() {
    if (rec.isRecording) {
      await recorder.stop();
      const secs = (rec.durationMillis ?? 0) / 1000;
      if (recorder.uri && secs >= 1) setFiles((f) => [...f, { uri: recorder.uri!, name: `Voice clip ${new Date().toLocaleString()}.m4a`, type: "audio/mp4", size: 0, duration: secs }]);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      return;
    }
    if (!(await AudioModule.requestRecordingPermissionsAsync()).granted) return Alert.alert("Microphone access is off", "Allow it in Settings to record voice clips.");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function send() {
    let body = text.trim();
    if ((!body && !files.length) || sending) return;
    setSending(true);
    setNotice("");
    try {
      if (body.startsWith("/") && !files.length) {
        const r = await runCommand(body, { me, channel: c, profiles, reload });
        if (r && !r.body) {
          setText("");
          setNotice(r.notice ?? "");
          return;
        }
        if (r?.body) body = r.body;
      }
      const attachments: Attachment[] = [];
      for (const f of files) {
        const data = await (await fetch(f.uri)).arrayBuffer();
        const size = f.size || data.byteLength;
        // Per-file limit comes from the company's plan; the bucket only knows the largest plan's
        if (plan?.max_file_bytes && size > plan.max_file_bytes)
          throw new Error(`${f.name} is ${fmtBytes(size)}. Files on the ${plan.name} plan can be up to ${fmtBytes(plan.max_file_bytes)}.`);
        const path = `${channelId}/${randomUUID()}/${f.name}`;
        const { error } = await supabase.storage.from("attachments").upload(path, data, { contentType: f.type });
        if (error && /row-level security|policy/i.test(error.message))
          throw new Error(`Your company has used all of its file storage${plan ? ` on the ${plan.name} plan` : ""}. An admin can free up space or upgrade.`);
        if (error) throw error;
        attachments.push({ name: f.name, path, size, type: f.type, ...(f.duration ? { duration: f.duration } : {}) });
      }
      const byName = new Map(Object.values(profiles).map((p) => [p.username.toLowerCase(), p.id]));
      const { data, error } = await supabase
        .from("messages")
        .insert({ channel_id: channelId, user_id: me.id, parent_id: parentId, also_in_channel: !!parentId && alsoSend, body, attachments, mentions: mentionIds(body, byName) })
        .select()
        .single();
      if (error) throw error;
      setText("");
      setFiles([]);
      setAlsoSend(false);
      onSent(data as Message);
    } catch (e) {
      Alert.alert("Couldn't send", (e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const canSend = !!text.trim() || files.length > 0;
  return (
    <View style={s.wrap}>
      {!!notice && (
        <Pressable onPress={() => setNotice("")} style={s.notice}>
          <Text style={{ color: C.text }}>{notice}</Text>
          <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>Only visible to you · tap to dismiss</Text>
        </Pressable>
      )}
      {(suggestions.length > 0 || commands.length > 0) && (
        <View style={s.popup}>
          {suggestions.map((x) => (
            <Pressable key={x.username} onPress={() => pickMention(x.username)} style={s.option}>
              {x.id ? (
                <Avatar p={profiles[x.id]} size={24} />
              ) : (
                <View style={{ width: 24, alignItems: "center" }}>
                  <Icon name="volume-2" size={16} />
                </View>
              )}
              <Text style={{ fontWeight: "700" }}>{x.label}</Text>
              <Text style={{ color: C.muted }}>@{x.username}</Text>
            </Pressable>
          ))}
          {commands.map(([cmd, hint]) => (
            <Pressable key={cmd} onPress={() => setText(`${cmd} `)} style={s.option}>
              <Text style={{ fontWeight: "700" }}>{cmd}</Text>
              <Text style={{ color: C.muted, flex: 1 }} numberOfLines={1}>
                {hint}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {files.length > 0 && (
        <ScrollView horizontal style={{ maxHeight: 44 }} contentContainerStyle={{ gap: 6, paddingBottom: 6 }}>
          {files.map((f, i) => (
            <Pressable key={f.uri + i} onPress={() => setFiles((all) => all.filter((_, j) => j !== i))} style={s.file}>
              <Icon name={f.type.startsWith("image/") ? "image" : f.type.startsWith("audio/") ? "mic" : f.type.startsWith("video/") ? "film" : "paperclip"} size={14} style={{ marginRight: 4 }} />
              <Text numberOfLines={1} style={{ maxWidth: 160 }}>
                {f.name}
              </Text>
              <Text style={{ color: C.muted }}> ✕</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {parentId && (
        <View style={s.also}>
          <Switch value={alsoSend} onValueChange={setAlsoSend} />
          <Text style={{ color: C.muted }}>Also send to {c?.kind === "dm" ? "direct message" : `#${c?.name}`}</Text>
        </View>
      )}
      <View style={s.row}>
        <Pressable onPress={attach} style={s.icon} hitSlop={8}>
          <Icon name="plus" size={22} />
        </Pressable>
        <TextInput
          ref={input}
          style={s.input}
          multiline
          placeholder={rec.isRecording ? `Recording ${clock((rec.durationMillis ?? 0) / 1000)}…` : parentId ? "Reply…" : `Message ${c?.kind === "dm" ? channelTitle(c) : `#${c?.name ?? ""}`}`}
          value={text}
          editable={!rec.isRecording}
          onChangeText={(t) => {
            setText(t);
            onTyping();
          }}
          onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
        />
        {canSend && !rec.isRecording ? (
          <Pressable onPress={send} disabled={sending} style={[s.send, sending && { opacity: 0.5 }]}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>{sending ? "…" : "Send"}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={toggleRecording} style={[s.icon, rec.isRecording && s.recording]} hitSlop={8}>
            <Icon name={rec.isRecording ? "square" : "mic"} size={20} color={rec.isRecording ? C.red : C.muted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 10, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, maxHeight: 140, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  icon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  recording: { backgroundColor: "#fde8ee" },
  send: { backgroundColor: C.green, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  popup: { borderWidth: 1, borderColor: C.line, borderRadius: 8, marginBottom: 8, backgroundColor: "#fff" },
  option: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  file: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  also: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  notice: { backgroundColor: "#f4f8fb", borderRadius: 8, padding: 10, marginBottom: 8 },
});
