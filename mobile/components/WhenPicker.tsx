import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { C, field } from "./ui";

// Date and time: inline pickers on iOS, the system dialogs on Android
export default function WhenPicker({ value, onChange, mode = "datetime" }: { value: Date; onChange: (d: Date) => void; mode?: "date" | "datetime" }) {
  if (Platform.OS === "ios")
    return <DateTimePicker value={value} mode={mode} display="compact" minimumDate={new Date()} onChange={(_, d) => d && onChange(d)} style={{ alignSelf: "flex-start" }} />;
  const open = (m: "date" | "time") =>
    DateTimePickerAndroid.open({
      value,
      mode: m,
      minimumDate: m === "date" ? new Date() : undefined,
      onChange: (e, d) => {
        if (e.type !== "set" || !d) return;
        const next = new Date(value);
        if (m === "date") next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
        else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
        onChange(next);
      },
    });
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Pressable onPress={() => open("date")} style={[field, { flex: 1 }]}>
        <Text>{value.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</Text>
      </Pressable>
      {mode === "datetime" && (
        <Pressable onPress={() => open("time")} style={[field, { width: 110 }]}>
          <Text style={{ color: C.text }}>{value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
        </Pressable>
      )}
    </View>
  );
}
