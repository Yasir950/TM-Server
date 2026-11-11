import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase, WEB_URL } from "@/lib/supabase";
import { Button, C } from "./ui";

type Mode = "signin" | "signup" | "forgot";

// Same flows as src/components/Auth.tsx; email links land on the web app
export default function SignIn() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(null);

  async function submit() {
    setMsg(null);
    setBusy(true);
    const redirectTo = `${WEB_URL}/app`;
    const res =
      mode === "forgot"
        ? await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
        : mode === "signin"
          ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
          : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName }, emailRedirectTo: redirectTo } });
    setBusy(false);
    if (res.error) return setMsg({ error: true, text: res.error.message });
    if (mode === "forgot") setMsg({ text: "If an account exists for that email, a reset link is on its way." });
    else if (mode === "signup" && !("session" in res.data && res.data.session)) setMsg({ text: "Check your email to confirm your account, then sign in." });
  }

  const switchTo = (m: Mode) => {
    setMode(m);
    setMsg(null);
  };

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={s.logo}>Workchime</Text>
      <Text style={s.title}>{mode === "signin" ? "Sign in to your workspace" : mode === "signup" ? "Create your account" : "Reset your password"}</Text>
      <View style={{ gap: 12, marginTop: 24 }}>
        {mode === "signup" && <TextInput style={s.input} placeholder="Full name" value={fullName} onChangeText={setFullName} />}
        <TextInput style={s.input} placeholder="name@work-email.com" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
        {mode !== "forgot" && <TextInput style={s.input} placeholder="Password" secureTextEntry autoComplete={mode === "signin" ? "password" : "new-password"} value={password} onChangeText={setPassword} />}
        <Button title={busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"} disabled={busy} onPress={submit} />
        {msg && <Text style={{ color: msg.error ? C.red : C.green }}>{msg.text}</Text>}
        {mode === "signin" && <Link text="Forgot password?" onPress={() => switchTo("forgot")} />}
        <Link text={mode === "signin" ? "New to Workchime? Create an account" : "Back to sign in"} onPress={() => switchTo(mode === "signin" ? "signup" : "signin")} />
      </View>
    </KeyboardAvoidingView>
  );
}

const Link = ({ text, onPress }: { text: string; onPress: () => void }) => (
  <Pressable onPress={onPress}>
    <Text style={{ color: C.blue, fontWeight: "600", textAlign: "center", marginTop: 4 }}>{text}</Text>
  </Pressable>
);

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: C.bg },
  logo: { fontSize: 32, fontWeight: "800", color: C.brand, textAlign: "center" },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center", marginTop: 16, color: C.text },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, fontSize: 16 },
});
