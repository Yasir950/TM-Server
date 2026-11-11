import { Image, Pressable, StyleSheet, Text, View, type PressableProps } from "react-native";
import { displayName, type Profile } from "@/lib/supabase";

export const C = { brand: "#0f2d4d", blue: "#1264a3", text: "#1d1c1d", muted: "#616061", line: "#e8e8e8", bg: "#ffffff", red: "#e01e5a", green: "#2bac76" };

const COLORS = ["#e8912d", "#2bac76", "#1264a3", "#cd2553", "#9b59b6", "#3aa3e3"];
const colorFor = (id: string) => COLORS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];

export function Avatar({ p, size = 36, online }: { p?: Profile; size?: number; online?: boolean }) {
  const r = size * 0.22;
  return (
    <View style={{ width: size, height: size }}>
      {p?.avatar_url ? (
        <Image source={{ uri: p.avatar_url }} style={{ width: size, height: size, borderRadius: r }} />
      ) : (
        <View style={{ width: size, height: size, borderRadius: r, backgroundColor: colorFor(p?.id ?? "?"), alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.42 }}>{displayName(p).charAt(0).toUpperCase()}</Text>
        </View>
      )}
      {online !== undefined && <View style={[s.dot, { backgroundColor: online ? C.green : "#bbb" }]} />}
    </View>
  );
}

export function Button({ title, disabled, ...rest }: PressableProps & { title: string }) {
  return (
    <Pressable {...rest} disabled={disabled} style={({ pressed }) => [s.btn, (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={s.btnText}>{title}</Text>
    </Pressable>
  );
}

export function Badge({ n }: { n: number }) {
  return n ? (
    <View style={s.badge}>
      <Text style={s.badgeText}>{n > 99 ? "99+" : n}</Text>
    </View>
  ) : null;
}

// Pill-style tab switcher
export function Segmented<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={s.seg}>
      {tabs.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} style={[s.segItem, value === k && s.segOn]}>
          <Text style={{ color: value === k ? C.blue : C.muted, fontWeight: "600", fontSize: 13 }} numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export const GhostButton = ({ title, onPress, danger }: { title: string; onPress: () => void; danger?: boolean }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.ghost, pressed && { backgroundColor: "#f4f4f4" }]}>
    <Text style={{ color: danger ? C.red : C.text, fontWeight: "600" }}>{title}</Text>
  </Pressable>
);

export const Empty = ({ icon, text }: { icon: string; text: string }) => (
  <View style={{ alignItems: "center", padding: 32, gap: 8 }}>
    <Text style={{ fontSize: 32 }}>{icon}</Text>
    <Text style={{ color: C.muted, textAlign: "center" }}>{text}</Text>
  </View>
);

export const Label = ({ children }: { children: React.ReactNode }) => <Text style={s.label}>{children}</Text>;

export const field = { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, backgroundColor: "#fff" } as const;

const s = StyleSheet.create({
  seg: { flexDirection: "row", backgroundColor: "#f1f1f1", borderRadius: 10, padding: 3, margin: 12 },
  segItem: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 8 },
  segOn: { backgroundColor: "#fff" },
  ghost: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" },
  label: { fontWeight: "700", color: C.muted, fontSize: 13, marginBottom: 6 },
  dot: { position: "absolute", right: -2, bottom: -2, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: "#fff" },
  btn: { backgroundColor: C.brand, borderRadius: 8, paddingVertical: 13, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.red, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
