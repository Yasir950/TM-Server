"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, openedFromRecoveryLink } from "@/lib/supabase";
import Auth, { DesktopSignIn } from "@/components/Auth";
import { ChatProvider } from "@/components/chat/store";
import Chat from "@/components/chat/Chat";

export default function Home() {
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

  if (session === undefined) return null;
  // Desktop builds with browser sign-in show only a sign-in button; older ones keep the form
  if (!session) return window.workchime?.signIn ? <DesktopSignIn /> : <Auth />;
  if (recovering) return <Auth recovery onDone={() => setRecovering(false)} />;
  return (
    <ChatProvider key={session.user.id} session={session}>
      <Chat />
    </ChatProvider>
  );
}
