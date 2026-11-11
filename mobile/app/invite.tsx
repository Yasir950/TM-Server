import { useState } from "react";
import { ScrollView, Share, Text, TextInput, View } from "react-native";
import { supabase, isAdmin, WEB_URL, type Role } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import Choice from "@/components/Choice";
import { Button, C, Label, field } from "@/components/ui";

const inviteUrl = (token: string) => `${WEB_URL}/app?invite=${token}`;

// Port of InviteModal: one single-use join link per email address, shared from the phone
export default function Invite() {
  const { me } = useChat();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [links, setLinks] = useState<{ email: string; token: string }[]>([]);
  const [error, setError] = useState("");

  async function send() {
    const list = [...new Set(emails.match(/[^\s,;<>"]+@[^\s,;<>"]+\.[a-z]{2,}/gi) ?? [])];
    if (!list.length) return setError("Enter at least one email address");
    const { data, error } = await supabase.rpc("invite_members", { p_emails: list, p_role: role });
    setError(error?.message ?? "");
    if (data) {
      setLinks(data);
      setEmails("");
    }
  }

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Label>Email addresses (comma or new line separated)</Label>
      <TextInput style={[field, { minHeight: 90, textAlignVertical: "top" }]} multiline autoCapitalize="none" keyboardType="email-address" placeholder="ana@acme.com, li@acme.com" value={emails} onChangeText={setEmails} />
      <Choice
        value={role}
        options={[...(isAdmin(me) ? [{ value: "admin" as Role, label: "Admin" }] : []), { value: "member", label: "Member" }, { value: "guest", label: "Guest" }]}
        onChange={setRole}
      />
      <Button title="Create invites" onPress={send} />
      {!!error && <Text style={{ color: C.red }}>{error}</Text>}
      {links.length > 0 && (
        <View style={{ backgroundColor: "#f6f6f6", borderRadius: 10, padding: 12, gap: 8 }}>
          <Text style={{ color: C.muted }}>Send each person their join link (valid 30 days, single use):</Text>
          {links.map((l) => (
            <View key={l.token} style={{ flexDirection: "row" }}>
              <Text style={{ flex: 1 }} numberOfLines={1}>
                {l.email}
              </Text>
              <Text style={{ color: C.blue, fontWeight: "600" }} onPress={() => Share.share({ message: `Join us on Workchime: ${inviteUrl(l.token)}` })}>
                Share link
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
