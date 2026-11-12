import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { C, field } from "./ui";
import { Icon } from "./Icon";

export type Option<T extends string> = { value: T; label: string; icon?: React.ReactNode };

// A field that opens a bottom sheet of options (the mobile stand-in for <select>)
export default function Choice<T extends string>({ value, options, onChange, placeholder = "Choose…", compact }: { value: T; options: Option<T>[]; onChange: (v: T) => void; placeholder?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={compact ? { flexDirection: "row", alignItems: "center", gap: 4 } : [field, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
        {current?.icon}
        <Text style={{ flex: compact ? undefined : 1, color: current ? C.text : C.muted }}>{current?.label ?? placeholder}</Text>
        <Icon name="chevron-down" size={14} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }} onPress={() => setOpen(false)} />
        <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "60%", paddingBottom: 30 }}>
          <ScrollView>
            {options.map((o) => (
              <Pressable
                key={o.value}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 14 }, pressed && { backgroundColor: "#f4f4f4" }]}
              >
                {o.icon}
                <Text style={{ flex: 1, fontSize: 16, fontWeight: o.value === value ? "800" : "400" }}>{o.label}</Text>
                {o.value === value && <Icon name="check" size={16} color={C.blue} />}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
