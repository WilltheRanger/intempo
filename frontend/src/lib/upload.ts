import { authedFetch } from "./api";
import { supabase } from "./supabase";

type UploadResponse = { upload_url: string; object_key: string };

/**
 * Upload an audio blob to the audio-uploads bucket and return a signed
 * *read* URL the backend can fetch (for /v1/calibration and /v1/analyses).
 * Same storage-handshake caveat as the score upload — see EDIT_LOG.
 */
export async function uploadAudioClip(
  blob: Blob,
  ext = "webm",
): Promise<string> {
  const signed = await authedFetch<UploadResponse>("/v1/upload/audio", {
    method: "POST",
    body: JSON.stringify({ filename: `clip.${ext}` }),
  });

  const putUrl = signed.upload_url.startsWith("http")
    ? signed.upload_url
    : `${import.meta.env.VITE_SUPABASE_URL ?? ""}${signed.upload_url}`;

  const put = await fetch(putUrl, {
    method: "PUT",
    headers: { "content-type": `audio/${ext}` },
    body: blob,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status}).`);

  if (!supabase) throw new Error("Storage is not configured.");
  const { data, error } = await supabase.storage
    .from("audio-uploads")
    .createSignedUrl(signed.object_key, 600);
  if (error || !data?.signedUrl) {
    throw new Error("Couldn't read back the recording.");
  }
  return data.signedUrl;
}
