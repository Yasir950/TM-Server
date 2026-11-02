import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Incoming webhook: POST {"text": "...", "username": "optional", "blocks": [Block Kit, optional]} to /api/webhooks/<token>
export async function POST(req: NextRequest, ctx: RouteContext<"/api/webhooks/[token]">) {
  const { token } = await ctx.params;
  let payload: { text?: string; username?: string; blocks?: unknown[] };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.rpc("post_webhook", {
    p_token: token,
    p_text: payload.text ?? "",
    p_username: payload.username ?? null,
    p_blocks: payload.blocks ?? null,
  });
  if (error) {
    const code = ["invalid_token", "text_required", "text_too_long", "invalid_blocks", "channel_archived"].find((c) => error.message.includes(c));
    return Response.json({ ok: false, error: code ?? "server_error" }, { status: code === "invalid_token" ? 404 : code ? 400 : 500 });
  }
  return Response.json({ ok: true, id: data });
}
