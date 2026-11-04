import { createClient } from "@supabase/supabase-js";

// Mints a one-time sign-in token for the desktop app (app/desktop-auth/page.tsx), so the app gets a session
// of its own instead of sharing the browser's. Called with the browser's access token; needs SUPABASE_SERVICE_ROLE_KEY.
export async function POST(req: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return Response.json({ error: "Desktop sign-in is not configured on the server" }, { status: 503 });
  const jwt = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!jwt) return Response.json({ error: "Sign in first" }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth.user?.email) return Response.json({ error: "Sign in first" }, { status: 401 });

  // generateLink only creates the token; no email is sent
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: auth.user.email });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ token_hash: data.properties.hashed_token }, { headers: { "cache-control": "no-store" } });
}
