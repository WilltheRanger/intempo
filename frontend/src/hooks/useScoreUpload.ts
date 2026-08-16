import { useMutation } from "@tanstack/react-query";

import { authedFetch } from "../lib/api";
import { supabase } from "../lib/supabase";
import { toUploadBlob } from "../lib/image";
import type { ScoreJson, ScoreResponse } from "../lib/score";

const SCORE_BUCKET = "score-images";
const SIGNED_READ_TTL = 300; // seconds — long enough for the OCR call to fetch

type UploadResponse = {
  upload_url: string;
  public_url: string;
  object_key: string;
};

/**
 * Full capture→parse flow (spec §6 step 3): normalize the image, PUT it
 * to storage via a presigned URL, then hand a signed *read* URL to
 * POST /v1/scores, which runs OCR synchronously and returns the parsed
 * score. (Our /v1/scores is synchronous — no polling needed.)
 *
 * NOTE: the exact storage handshake (presigned-PUT URL shape + a signed
 * read URL the backend can fetch) depends on the live Supabase project's
 * bucket visibility and storage RLS. Verified to compile; the true
 * end-to-end needs real keys — see the Batch 6 EDIT_LOG entry.
 */
async function runUpload({
  file,
  title,
}: {
  file: File | Blob;
  title: string;
}): Promise<ScoreResponse> {
  const blob = await toUploadBlob(file);

  const signed = await authedFetch<UploadResponse>("/v1/upload/score-image", {
    method: "POST",
    body: JSON.stringify({ filename: "capture.jpg" }),
  });

  const putUrl = signed.upload_url.startsWith("http")
    ? signed.upload_url
    : `${import.meta.env.VITE_SUPABASE_URL ?? ""}${signed.upload_url}`;

  const put = await fetch(putUrl, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: blob,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status}).`);

  if (!supabase) throw new Error("Storage is not configured.");
  const { data, error } = await supabase.storage
    .from(SCORE_BUCKET)
    .createSignedUrl(signed.object_key, SIGNED_READ_TTL);
  if (error || !data?.signedUrl) {
    throw new Error("Couldn't read back the uploaded image.");
  }

  return authedFetch<ScoreResponse>("/v1/scores", {
    method: "POST",
    body: JSON.stringify({ image_url: data.signedUrl, title }),
  });
}

export function useScoreUpload() {
  return useMutation({ mutationFn: runUpload });
}

export function useScoreSave() {
  return useMutation({
    mutationFn: ({
      id,
      scoreJson,
      title,
    }: {
      id: string;
      scoreJson: ScoreJson;
      title: string;
    }) =>
      authedFetch<ScoreResponse>(`/v1/scores/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ score_json: scoreJson, title }),
      }),
  });
}
