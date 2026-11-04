"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { signOut } from "@/lib/push";
import { Logo, btn, input } from "./ui";
import { Icon } from "./icons";
import { APP_NAME } from "@/lib/brand";

type Mode = "signin" | "signup" | "forgot" | "reset";

const copy: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  signin: { title: "Sign in to your workspace", subtitle: "We suggest using the email address you use at work.", submit: "Sign in" },
  signup: { title: "Create your account", subtitle: "We suggest using the email address you use at work.", submit: "Create account" },
  forgot: { title: "Reset your password", subtitle: "Enter your email and we'll send you a link to choose a new password.", submit: "Send reset link" },
  reset: { title: "Choose a new password", subtitle: "Use at least 6 characters.", submit: "Update password" },
};

// A failed reset link (expired or already used) comes back with the reason in the URL hash
function linkError() {
  if (typeof window === "undefined") return null;
  const text = new URLSearchParams(window.location.hash.slice(1)).get("error_description");
  return text ? { error: true, text: `${text.replace(/\+/g, " ")}. Request a new reset link below.` } : null;
}

// Desktop app: signing in (or up) happens in the browser at app/desktop-auth, which sends back a one-time token
// through a workchime:// link that desktop/main.js holds for takeAuth()
export function DesktopSignIn() {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const take = async () => {
      const tokenHash = await window.workchime?.takeAuth?.();
      if (!tokenHash) return;
      setWaiting(true);
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      if (!error) return;
      setError(`${error.message}. Try signing in again.`);
      setWaiting(false);
    };
    take();
    return window.workchime?.onAuth?.(take);
  }, []);

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-white px-4 py-12 text-center">
      <Logo height={60} />
      <h1 className="mt-8 text-3xl font-bold">Welcome to {APP_NAME}</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        {waiting ? "Finish signing in in your browser, then come back here." : "We'll open your browser so you can sign in or create an account."}
      </p>
      <button
        className={`${btn} mt-8 w-full max-w-sm py-2.5`}
        onClick={() => {
          setError("");
          setWaiting(true);
          window.workchime?.signIn?.();
        }}
      >
        {waiting ? "Open the browser again" : "Sign in with your browser"}
      </button>
      {error && <p className="mt-3 max-w-sm text-sm text-red-600">{error}</p>}
    </div>
  );
}

// recovery: the user arrived from a reset email and already has a session; onDone lets them into the app
// redirectTo: where confirmation and reset emails link back to (default: the app)
export default function Auth({ recovery, onDone, redirectTo }: { recovery?: boolean; onDone?: () => void; redirectTo?: string }) {
  const initialError = recovery ? null : linkError();
  const [mode, setMode] = useState<Mode>(recovery ? "reset" : initialError ? "forgot" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(initialError);

  function switchMode(m: Mode) {
    setMode(m);
    setMsg(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (mode === "reset" && password !== confirm) return setMsg({ error: true, text: "Passwords don't match." });
    setBusy(true);
    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo ?? window.location.origin });
      setBusy(false);
      if (error) setMsg({ error: true, text: error.message });
      else setMsg({ text: "If an account exists for that email, a reset link is on its way. Check your inbox." });
      return;
    }
    if (mode === "reset") {
      const { error } = await supabase.auth.updateUser({ password });
      setBusy(false);
      if (error) setMsg({ error: true, text: error.message });
      else onDone?.();
      return;
    }
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: redirectTo ?? window.location.origin } });
    setBusy(false);
    if (error) setMsg({ error: true, text: error.message });
    else if (mode === "signup" && !data.session) setMsg({ text: "Check your email to confirm your account." });
  }

  const passwordField = (value: string, onChange: (v: string) => void, placeholder: string, autoComplete: string) => (
    <div className="relative">
      <input
        className={`${input} pr-11`}
        type={showPassword ? "text" : "password"}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-zinc-400 transition hover:text-zinc-700"
        aria-label={showPassword ? "Hide password" : "Show password"}
        title={showPassword ? "Hide password" : "Show password"}
      >
        <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
      </button>
    </div>
  );

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-white px-4 py-12">
      <Logo height={60} />
      <h1 className="mt-8 text-center text-3xl font-bold">{copy[mode].title}</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-zinc-500">{copy[mode].subtitle}</p>
      <form onSubmit={submit} className="mt-8 w-full max-w-sm space-y-3">
        {mode === "signup" && (
          <input className={input} placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        )}
        {mode !== "reset" && (
          <input
            className={input}
            type="email"
            placeholder="name@work-email.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        )}
        {(mode === "signin" || mode === "signup") &&
          passwordField(password, setPassword, "Password", mode === "signin" ? "current-password" : "new-password")}
        {mode === "reset" && (
          <>
            {passwordField(password, setPassword, "New password", "new-password")}
            {passwordField(confirm, setConfirm, "Confirm new password", "new-password")}
          </>
        )}
        {mode === "signin" && (
          <div className="flex justify-end">
            <button type="button" className="text-sm font-medium text-tm-blue hover:underline" onClick={() => switchMode("forgot")}>
              Forgot password?
            </button>
          </div>
        )}
        <button className={`${btn} w-full py-2.5`} disabled={busy}>
          {busy ? "Please wait…" : copy[mode].submit}
        </button>
        {msg && <p className={`text-sm ${msg.error ? "text-red-600" : "text-tm-green"}`}>{msg.text}</p>}
      </form>
      <p className="mt-6 text-sm text-zinc-500">
        {mode === "reset" ? (
          <button className="font-semibold text-tm-blue hover:underline" onClick={signOut}>
            Cancel and sign out
          </button>
        ) : mode === "forgot" ? (
          <>
            Remembered it?{" "}
            <button className="font-semibold text-tm-blue hover:underline" onClick={() => switchMode("signin")}>
              Back to sign in
            </button>
          </>
        ) : (
          <>
            {mode === "signin" ? `New to ${APP_NAME}? ` : "Already have an account? "}
            <button className="font-semibold text-tm-blue hover:underline" onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}>
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
