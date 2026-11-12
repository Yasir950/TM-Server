"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase, openedFromRecoveryLink } from "@/lib/supabase";
import Auth, { DesktopSignIn } from "@/components/Auth";
import { ChatProvider } from "@/components/chat/store";
import Chat from "@/components/chat/Chat";

// The app lives at /app; the public site is at / (app/(site)/page.tsx).
// Signed-out visitors who just typed /app in a browser get the public site.
// Anything with a query or hash (sign-in/sign-up buttons, invites, message links, email callbacks),
// the desktop app and the installed home-screen app go straight to sign-in.
const showPublicSite = (hasQuery: boolean) =>
  !hasQuery && !window.location.hash && !window.workchime && !window.matchMedia("(display-mode: standalone)").matches;

// Cache Components keeps this page alive (hidden) after it sends a signed-out visitor to the site, so the query
// has to come from useSearchParams: coming back via a Sign in button (/app?signin) then re-renders with the new
// query instead of replaying the old "no query, back to the site" redirect.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}

function Home() {
  const router = useRouter();
  const params = useSearchParams();
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

  const toSite = session === null && !recovering && showPublicSite(params.size > 0);
  useEffect(() => {
    if (toSite) router.replace("/");
  }, [toSite, router]);

  // The ?signin / ?signup flags only pick the auth screen; drop them once signed in
  const signedIn = !!session;
  useEffect(() => {
    if (!signedIn) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("signin") && !url.searchParams.has("signup")) return;
    url.searchParams.delete("signin");
    url.searchParams.delete("signup");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [signedIn]);

  if (session === undefined || toSite) return null;
  // Desktop builds with browser sign-in show only a sign-in button; older ones keep the form
  if (!session) return window.workchime?.signIn ? <DesktopSignIn /> : <Auth key={params.has("signup") ? "signup" : "signin"} signup={params.has("signup")} />;
  if (recovering) return <Auth recovery onDone={() => setRecovering(false)} />;
  return (
    <ChatProvider key={session.user.id} session={session}>
      <Chat />
    </ChatProvider>
  );
}
