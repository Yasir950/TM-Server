import type { NextRequest } from "next/server";
import { admin, scimError, toScim, unauthorized } from "./scim";

export async function GET(req: NextRequest) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const start = Math.max(1, Number(sp.get("startIndex") ?? 1));
  const count = Math.min(200, Math.max(1, Number(sp.get("count") ?? 100)));
  const { data, error } = await admin().auth.admin.listUsers({ page: Math.ceil(start / count), perPage: count });
  if (error) return scimError(500, error.message);
  // IdPs look users up with filter=userName eq "x"
  const eq = /userName eq "([^"]+)"/i.exec(sp.get("filter") ?? "")?.[1]?.toLowerCase();
  const users = eq ? data.users.filter((u) => u.email?.toLowerCase() === eq) : data.users;
  return Response.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: eq ? users.length : (data.total ?? users.length),
    startIndex: start,
    itemsPerPage: users.length,
    Resources: users.map(toScim),
  });
}

export async function POST(req: NextRequest) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const email: string | undefined = body?.emails?.[0]?.value ?? body?.userName;
  if (!email) return scimError(400, "userName is required");
  const fullName = body?.name?.formatted ?? [body?.name?.givenName, body?.name?.familyName].filter(Boolean).join(" ");
  const { data, error } = await admin().auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) return scimError(error.status === 422 ? 409 : 400, error.message);
  return Response.json(toScim(data.user), { status: 201 });
}
