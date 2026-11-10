import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// GET with the caller's access token as Bearer → { iceServers } for huddles.
// TURN secrets stay on the server; signed-in users get short-lived relay credentials.
// Providers, first one configured wins:
//   Cloudflare (1,000 GB/month free): CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN
//   Metered Open Relay (20 GB/month free): METERED_TURN_DOMAIN (e.g. myapp.metered.live) + METERED_TURN_API_KEY
const TTL = 12 * 60 * 60;

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "not_authenticated" }, { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return Response.json({ error: "not_authenticated" }, { status: 401 });

  const headers = { "Cache-Control": "private, no-store" };
  try {
    const cfKey = process.env.CLOUDFLARE_TURN_KEY_ID;
    const cfToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
    if (cfKey && cfToken) {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${cfKey}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TTL }),
      });
      if (!res.ok) throw new Error(`cloudflare ${res.status}`);
      const { iceServers } = (await res.json()) as { iceServers: RTCIceServer[] };
      // Browsers block port 53, so those URLs would only ever time out
      const clean = iceServers.map((s) => ({ ...s, urls: [s.urls].flat().filter((u) => !/:53(\?|$)/.test(u)) }));
      return Response.json({ iceServers: clean }, { headers });
    }

    const mDomain = process.env.METERED_TURN_DOMAIN;
    const mKey = process.env.METERED_TURN_API_KEY;
    if (mDomain && mKey) {
      const res = await fetch(`https://${mDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(mKey)}`);
      if (!res.ok) throw new Error(`metered ${res.status}`);
      return Response.json({ iceServers: (await res.json()) as RTCIceServer[] }, { headers });
    }
  } catch (e) {
    console.warn("turn", e);
    return Response.json({ iceServers: [], error: "turn_unavailable" }, { status: 502, headers });
  }
  return Response.json({ iceServers: [] }, { headers });
}
