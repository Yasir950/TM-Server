import { createClient, type User } from "@supabase/supabase-js";

// SCIM 2.0 provisioning for identity providers (Okta, Entra ID…). Needs SCIM_TOKEN and SUPABASE_SERVICE_ROLE_KEY.
export const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

export function unauthorized(req: Request) {
  const token = process.env.SCIM_TOKEN;
  if (token && process.env.SUPABASE_SERVICE_ROLE_KEY && req.headers.get("authorization") === `Bearer ${token}`) return null;
  return scimError(401, "Unauthorized");
}

export const scimError = (status: number, detail: string) =>
  Response.json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: String(status), detail }, { status });

// A banned Supabase user is a deactivated SCIM user
export const toScim = (u: User) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  id: u.id,
  userName: u.email,
  name: { formatted: u.user_metadata?.full_name ?? "" },
  emails: [{ value: u.email, primary: true }],
  active: !u.banned_until || new Date(u.banned_until) < new Date(),
  meta: { resourceType: "User", created: u.created_at },
});

export const setActive = (id: string, active: boolean) =>
  admin().auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
