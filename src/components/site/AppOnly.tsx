"use client";

import { useEffect } from "react";

// Sends visitors who belong in the app (at /app) there from the public site:
// - the desktop app (desktop/preload.js exposes window.workchime) and the installed home-screen app, from any site page
// - links to "/" with a query or hash: older message, task, call and invite links (/?c=…, /?task=…, /?invite=…),
//   sign-in buttons (/?signin) and email confirmation callbacks (#access_token=…), keeping the query and hash
export default function AppOnly() {
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const installed = !!window.workchime || window.matchMedia("(display-mode: standalone)").matches;
    if (installed || (pathname === "/" && (search || hash))) window.location.replace(`/app${search}${hash}`);
  }, []);
  return null;
}
