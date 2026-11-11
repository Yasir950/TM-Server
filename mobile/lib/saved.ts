import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";

// Saved message ids, shared by every message row and the Saved screen (port of src/components/chat/useMessages.ts)
let saved: Set<string> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  if (!saved) {
    saved = new Set();
    supabase.from("saved_items").select("message_id").then(({ data }) => {
      saved = new Set((data ?? []).map((r) => r.message_id));
      emit();
    });
  }
  return () => listeners.delete(l);
}

export const useSavedIds = () => useSyncExternalStore(subscribe, () => saved);

// Forget the cache on sign-out so the next user loads their own
export const resetSaved = () => {
  saved = null;
};

export async function toggleSaved(messageId: string) {
  const next = new Set(saved);
  const has = next.has(messageId);
  if (has) next.delete(messageId);
  else next.add(messageId);
  saved = next;
  emit();
  if (has) await supabase.from("saved_items").delete().eq("message_id", messageId);
  else await supabase.from("saved_items").insert({ message_id: messageId });
}
