"use client";

import { useEffect } from "react";

// The desktop app (desktop/preload.js exposes window.workchime) shows only the app, never the public site:
// if it lands on a site page anyway, send it back to the app at "/"
export default function AppOnly() {
  useEffect(() => {
    if (window.workchime) window.location.replace("/");
  }, []);
  return null;
}
