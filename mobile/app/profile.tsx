import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { supabase, WEB_URL } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { pickAndUploadImage } from "@/lib/upload";
import { Avatar, Button, C, Label, field } from "@/components/ui";

// Port of the profile editor in src/components/chat/Company.tsx
export default function Profile() {
  const { me, members, reload } = useChat();
  const mine = members[me.id];
  const [fullName, setFullName] = useState(me.full_name);
  const [username, setUsername] = useState(me.username);
  const [designation, setDesignation] = useState(mine?.designation ?? "");
  const [phone, setPhone] = useState(mine?.phone ?? "");
  const [phoneVisible, setPhoneVisible] = useState(mine?.phone_visible ?? false);
  const [email, setEmail] = useState("");
  const [authEmail, setAuthEmail] = useState({ current: "", pending: "" });
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const current = data.user?.email ?? "";
      const pending = data.user?.new_email ?? "";
      setAuthEmail({ current, pending });
      setEmail(pending || current);
    });
  }, []);

  async function photo() {
    try {
      const url = await pickAndUploadImage(me.id);
      if (!url) return;
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
      await reload();
    } catch (e) {
      Alert.alert("Couldn't upload", (e as Error).message);
    }
  }

  async function save() {
    const cleanPhone = phone.replace(/[\s()-]/g, "");
    if (cleanPhone && !/^\+[1-9]\d{6,14}$/.test(cleanPhone)) return setNotice("Enter the phone number with its country code, e.g. +44 20 7946 0000");
    const nextEmail = email.trim().toLowerCase();
    if (nextEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nextEmail)) return setNotice("Enter a valid email address.");
    const emailChanged = !!nextEmail && nextEmail !== authEmail.current.toLowerCase() && nextEmail !== authEmail.pending.toLowerCase();
    setBusy(true);
    setNotice("");
    const [p, m] = await Promise.all([
      supabase.from("profiles").update({ full_name: fullName.trim(), username: username.trim().toLowerCase() }).eq("id", me.id),
      me.current_company_id
        ? supabase.from("company_members").update({ designation: designation.trim(), phone: cleanPhone, phone_visible: phoneVisible }).eq("company_id", me.current_company_id).eq("user_id", me.id)
        : Promise.resolve({ error: null }),
    ]);
    const err = p.error ?? m.error;
    if (err) {
      setBusy(false);
      return setNotice(err.message.includes("username") ? "That username is taken." : err.message);
    }
    let extra = "";
    if (emailChanged) {
      const { error } = await supabase.auth.updateUser({ email: nextEmail }, { emailRedirectTo: `${WEB_URL}/app` });
      if (!error) {
        setAuthEmail({ current: authEmail.current, pending: nextEmail });
        extra = ` Check ${authEmail.current || "your old inbox"} and ${nextEmail} to confirm the new email address.`;
      } else extra = ` Email not changed: ${error.message}`;
    }
    if (password) {
      const { error } = await supabase.auth.updateUser({ password });
      extra += error ? ` Password not changed: ${error.message}` : " Password updated.";
      if (!error) setPassword("");
    }
    await reload();
    setBusy(false);
    setNotice(`Saved.${extra}`);
  }

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: "center", gap: 8 }}>
        <Pressable onPress={photo}>
          <Avatar p={me} size={88} />
        </Pressable>
        <View style={{ flexDirection: "row", gap: 20 }}>
          <Text style={{ color: C.blue, fontWeight: "600" }} onPress={photo}>
            Change photo
          </Text>
          {me.avatar_url && (
            <Text style={{ color: C.muted }} onPress={async () => (await supabase.from("profiles").update({ avatar_url: null }).eq("id", me.id), reload())}>
              Remove
            </Text>
          )}
        </View>
      </View>
      <View>
        <Label>Full name</Label>
        <TextInput style={field} value={fullName} onChangeText={setFullName} />
      </View>
      <View>
        <Label>Username</Label>
        <TextInput style={field} value={username} onChangeText={setUsername} autoCapitalize="none" />
      </View>
      {me.current_company_id && (
        <>
          <View>
            <Label>Title</Label>
            <TextInput style={field} value={designation} onChangeText={setDesignation} placeholder="e.g. Product designer" />
          </View>
          <View>
            <Label>Phone</Label>
            <TextInput style={field} value={phone} onChangeText={setPhone} placeholder="+44 20 7946 0000" keyboardType="phone-pad" />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 16 }}>Show my phone to the workspace</Text>
            <Switch value={phoneVisible} onValueChange={setPhoneVisible} />
          </View>
        </>
      )}
      <View>
        <Label>Email</Label>
        <TextInput style={field} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        {!!authEmail.pending && <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Waiting for confirmation of {authEmail.pending}</Text>}
      </View>
      <View>
        <Label>New password (optional)</Label>
        <TextInput style={field} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 6 characters" />
      </View>
      {!!notice && <Text style={{ color: notice.startsWith("Saved") ? C.green : C.red }}>{notice}</Text>}
      <Button title={busy ? "Saving…" : "Save"} disabled={busy} onPress={save} />
    </ScrollView>
  );
}
