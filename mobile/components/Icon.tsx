import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Text, View, type StyleProp, type TextStyle } from "react-native";

// Single-color stroke icons (Feather, the set the web's Lucide-style icons come from). Tinted by `color`, never multicolor emoji.
const extra = { hand: "hand-back-right-outline", bug: "bug-outline", pin: "pin-outline", equal: "equal" } as const;
export type IconName = keyof typeof Feather.glyphMap | keyof typeof extra;

export function Icon({ name, size = 18, color = "#616061", style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  if (name in extra) return <MaterialCommunityIcons name={extra[name as keyof typeof extra]} size={size} color={color} style={style} />;
  return <Feather name={name as keyof typeof Feather.glyphMap} size={size} color={color} style={style} />;
}

// Header title for a channel: lock/hash icon + name (DMs have no icon)
export function ChannelTitle({ kind, text, color }: { kind: string; text: string; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
      {kind !== "dm" && <Icon name={channelIcon(kind)} size={16} color={color} />}
      <Text style={{ color, fontSize: 17, fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export const channelIcon = (kind: string): IconName => (kind === "private" ? "lock" : kind === "dm" ? "at-sign" : "hash");
