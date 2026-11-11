import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { C } from "./ui";

// A compact picker; the keyboard's emoji key covers anything not listed (type it into search and tap Use)
const EMOJI = "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤯 🥳 😎 🤓 😕 😟 😮 😲 😳 🥺 😢 😭 😱 😤 😡 👍 👎 👌 ✌️ 🤞 🤝 👏 🙌 🙏 💪 👀 👋 ✋ 👉 👈 ☝️ 👆 👇 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 💯 ✅ ❌ ⚠️ ❓ ❗ 🔥 ✨ ⭐ 🎉 🎊 🎁 🏆 🚀 💡 📌 📎 📅 ⏰ ☕ 🍕 🍰 🍻 🌟 🌈 ☀️ 🌧️ ⚡ 💤 💬 👑 🙈 🙉 🙊 🐛 🤖 💻 📈 📉 💰".split(" ");

export default function EmojiPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (e: string) => void }) {
  const [own, setOwn] = useState("");
  const pick = (e: string) => {
    onPick(e);
    setOwn("");
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }} onPress={onClose} />
      <View style={s.sheet}>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <TextInput style={s.input} placeholder="Or type any emoji" value={own} onChangeText={setOwn} />
          {!!own.trim() && (
            <Pressable onPress={() => pick(own.trim())} style={s.use}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>Use</Text>
            </Pressable>
          )}
        </View>
        <FlatList
          data={EMOJI}
          numColumns={8}
          keyExtractor={(e) => e}
          renderItem={({ item }) => (
            <Pressable onPress={() => pick(item)} style={s.cell}>
              <Text style={{ fontSize: 26 }}>{item}</Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheet: { backgroundColor: "#fff", height: 360, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  use: { backgroundColor: C.brand, borderRadius: 8, paddingHorizontal: 14, justifyContent: "center" },
  cell: { flex: 1, alignItems: "center", paddingVertical: 6 },
});
