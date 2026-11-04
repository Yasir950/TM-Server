"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import Auth from "@/components/Auth";
import { Logo, btn, btnGhost } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";

// Browser half of desktop sign-in: desktop/main.js opens this page with ?state=…. Once the user is signed in
// here, it hands the desktop app a one-time token through a workchime://auth link.
export default function DesktopAuth() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [state] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("state")));
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState("");
  const userId = session?.user.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId || !state) return;
    let live = true;
    (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch("/api/desktop-auth", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!live) return;
      if (!res.ok) return setError(body.error ?? "Something went wrong. Try again from the desktop app.");
      const url = `workchime://auth?state=${encodeURIComponent(state)}&token_hash=${encodeURIComponent(body.token_hash)}`;
      setLink(url);
      window.location.href = url;
    })();
    return () => {
      live = false;
    };
  }, [userId, state]);

  if (session === undefined) return null;
  if (!state)
    return (
      <Shell title={`Sign in to the ${APP_NAME} desktop app`}>
        <p className="text-sm text-zinc-500">Open the desktop app and click “Sign in with your browser” to start.</p>
        <Link href="/app" className={`${btn} mt-6 inline-block`}>Go to {APP_NAME}</Link>
      </Shell>
    );
  // Email confirmation and password reset links come back to this page, keeping the desktop sign-in going
  if (!session) return <Auth redirectTo={window.location.href} />;

  return (
    <Shell title={error ? "Couldn't sign in the desktop app" : `Opening ${APP_NAME}…`}>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <p className="text-sm text-zinc-500">
          Signed in as <b className="text-zinc-800">{session.user.email}</b>. When your browser asks, allow it to open {APP_NAME}. You can close this tab afterwards.
        </p>
      )}
      <div className="mt-6 flex flex-col items-center gap-3">
        {link && (
          <a href={link} className={`${btn} px-6 py-2.5`}>
            Open {APP_NAME}
          </a>
        )}
        {/* Local only: signing out everywhere would also end the session the desktop app just received */}
        <button className={btnGhost} onClick={() => supabase.auth.signOut({ scope: "local" })}>
          Use a different account
        </button>
      </div>
    </Shell>
  );
}

const Shell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex min-h-full flex-col items-center justify-center bg-white px-4 py-12 text-center">
    <Logo height={60} />
    <h1 className="mt-8 text-3xl font-bold">{title}</h1>
    <div className="mt-3 max-w-sm">{children}</div>
  </div>
);
