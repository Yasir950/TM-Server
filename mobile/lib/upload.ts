import * as ImagePicker from "expo-image-picker";
import { randomUUID } from "expo-crypto";
import { supabase } from "./supabase";

// Picks a square image and uploads it to the public avatars bucket (avatars, company logos); null if cancelled
export async function pickAndUploadImage(folder: string): Promise<string | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
  if (r.canceled) return null;
  const a = r.assets[0];
  const type = a.mimeType && /^image\/(jpeg|png|webp)$/.test(a.mimeType) ? a.mimeType : "image/jpeg";
  const data = await (await fetch(a.uri)).arrayBuffer();
  if (data.byteLength > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller");
  const path = `${folder}/${randomUUID()}.${type.split("/")[1]}`;
  const { error } = await supabase.storage.from("avatars").upload(path, data, { contentType: type });
  if (error) throw error;
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}
