"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase, openedFromRecoveryLink } from "@/lib/supabase";
import Auth, { DesktopSignIn } from "@/components/Auth";
import { ChatProvider } from "@/components/chat/store";
import Chat from "@/components/chat/Chat";

// Signed-out visitors who just typed the address in a browser get the public site (app/(site)/home).
// Anything with a query or hash (sign-in/sign-up buttons, invites, message links, email callbacks),
// the desktop app and the installed home-screen app go straight to sign-in.
const showPublicSite = () =>
  !window.location.search && !window.location.hash && !window.workchime && !window.matchMedia("(display-mode: standalone)").matches;

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Opened from a reset email: ask for a new password before entering the app
  const [recovering, setRecovering] = useState(openedFromRecoveryLink);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === "PASSWORD_RECOVERY") setRecovering(true);
      if (e === "SIGNED_OUT") setRecovering(false);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const toSite = session === null && !recovering && showPublicSite();
  useEffect(() => {
    if (toSite) router.replace("/home");
  }, [toSite, router]);

  if (session === undefined || toSite) return null;
  // Desktop builds with browser sign-in show only a sign-in button; older ones keep the form
  if (!session) return window.workchime?.signIn ? <DesktopSignIn /> : <Auth signup={new URLSearchParams(window.location.search).has("signup")} />;
  if (recovering) return <Auth recovery onDone={() => setRecovering(false)} />;
  return (
    <ChatProvider key={session.user.id} session={session}>
      <Chat />
    </ChatProvider>
  );
}
