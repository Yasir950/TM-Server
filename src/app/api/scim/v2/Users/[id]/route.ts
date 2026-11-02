import type { NextRequest } from "next/server";
import { admin, scimError, setActive, toScim, unauthorized } from "../scim";

type Ctx = RouteContext<"/api/scim/v2/Users/[id]">;

export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const { data, error } = await admin().auth.admin.getUserById((await ctx.params).id);
  return error || !data.user ? scimError(404, "User not found") : Response.json(toScim(data.user));
}

// Handles both PATCH Operations ({"op":"replace","value":{"active":false}}) and PUT bodies ({"active":false})
async function update(req: NextRequest, ctx: Ctx) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  let active: boolean | undefined = typeof body.active === "boolean" ? body.active : undefined;
  for (const op of body.Operations ?? []) {
    if (op.path === "active") active = op.value === true || op.value === "True" || op.value === "true";
    else if (typeof op.value?.active === "boolean") active = op.value.active;
  }
  if (active !== undefined) {
    const { error } = await setActive(id, active);
    if (error) return scimError(404, error.message);
  }
  return GET(req, ctx);
}
export const PATCH = update;
export const PUT = update;

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const denied = unauthorized(req);
  if (denied) return denied;
  // Deprovisioned users are deactivated rather than deleted so their messages keep an author
  const { error } = await setActive((await ctx.params).id, false);
  return error ? scimError(404, error.message) : new Response(null, { status: 204 });
}
