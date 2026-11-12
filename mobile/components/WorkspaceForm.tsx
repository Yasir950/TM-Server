import { useEffect, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { Button, C, GhostButton, Label, Segmented, field } from "./ui";

type Found = { id: string; name: string; logo_url: string | null; member_count: number };

// Port of Onboarding (src/components/chat/Company.tsx): create a company, join with an invite, or (super admins) find one by handle
export function WorkspaceForm({ onDone }: { onDone?: () => void }) {
  const { reload, superAdmin } = useChat();
  const [tab, setTab] = useState<"create" | "invite" | "find">("create");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [token, setToken] = useState("");
  const [found, setFound] = useState<Found | null | undefined>();
  const [requests, setRequests] = useState<{ company_id: string; status: string }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!superAdmin) return;
    supabase.from("join_requests").select("company_id,status").then(({ data }) => setRequests(data ?? []));
  }, [superAdmin]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    setError("");
    const { error } = await p;
    if (error) return setError(error.message);
    await reload();
    onDone?.();
  };

  return (
    <View style={{ gap: 12 }}>
      <Segmented
        // Finding companies by handle is for super admins only
        tabs={[
          ["create", "Create"],
          ["invite", "Invite"],
          ...(superAdmin ? [["find", "Find"] as ["find", string]] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "create" && (
        <>
          <Label>Company name</Label>
          <TextInput
            style={field}
            placeholder="e.g. Acme Inc."
            value={name}
            onChangeText={(v) => {
              setName(v);
              setHandle(v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 39));
            }}
          />
          <Label>Company handle</Label>
          <TextInput style={field} autoCapitalize="none" value={handle} onChangeText={(v) => setHandle(v.toLowerCase())} />
          <Text style={{ color: C.muted, fontSize: 12 }}>Lowercase letters, numbers and dashes. Teammates use it to find you.</Text>
          <Button title="Create company" disabled={!name.trim() || !/^[a-z0-9][a-z0-9-]{1,38}$/.test(handle)} onPress={() => run(supabase.rpc("create_company", { p_name: name, p_handle: handle }))} />
        </>
      )}
      {tab === "invite" && (
        <>
          <Label>Invite link or code</Label>
          <TextInput style={field} autoCapitalize="none" placeholder="https://…/?invite=…" value={token} onChangeText={setToken} />
          <Button title="Join company" disabled={!token.trim()} onPress={() => run(supabase.rpc("accept_invite", { p_token: token.trim().split("invite=").pop() }))} />
        </>
      )}
      {tab === "find" && superAdmin && (
        <>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput style={[field, { flex: 1 }]} autoCapitalize="none" placeholder="Company handle, e.g. acme" value={handle} onChangeText={setHandle} />
            <GhostButton
              title="Search"
              onPress={async () => {
                const { data } = await supabase.rpc("find_company", { p_handle: handle });
                setFound(data?.[0] ?? null);
              }}
            />
          </View>
          {found === null && <Text style={{ color: C.muted }}>No company with that handle accepts join requests.</Text>}
          {found && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12 }}>
              {found.logo_url && <Image source={{ uri: found.logo_url }} style={{ width: 36, height: 36, borderRadius: 8 }} />}
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700" }}>{found.name}</Text>
                <Text style={{ color: C.muted, fontSize: 12 }}>{found.member_count} members</Text>
              </View>
              <Pressable
                onPress={async () => {
                  const { error } = await supabase.rpc("request_join", { p_company: found.id });
                  setError(error?.message ?? "");
                  if (!error) setRequests((r) => [...r.filter((x) => x.company_id !== found.id), { company_id: found.id, status: "pending" }]);
                }}
                style={{ backgroundColor: C.brand, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>Request to join</Text>
              </Pressable>
            </View>
          )}
          {requests.some((r) => r.status === "pending") && (
            <Text style={{ color: C.muted }}>{requests.filter((r) => r.status === "pending").length} join request(s) waiting for an admin to approve.</Text>
          )}
        </>
      )}
      {!!error && <Text style={{ color: C.red }}>{error}</Text>}
    </View>
  );
}
