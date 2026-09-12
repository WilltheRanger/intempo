-- =============================================================
-- 016_storage_buckets — put the two oldest buckets under version control
-- =============================================================
--
-- **The two buckets holding a musician's sheet music and their playing exist
-- in no migration.** `avatars` was created properly in 009, with
-- `public = false` and four owner-scoped policies. `score-images` and
-- `audio-uploads` predate that discipline: they were made by hand in the
-- Supabase dashboard, and nothing in this repository says what they are
-- configured as.
--
-- Measured against `intempo-dev` on 2026-09-03, because speculation is not an
-- audit:
--
--     id              public   file_size_limit   allowed_mime_types
--     audio-uploads   false    52428800          null
--     avatars         false    null              null
--     score-images    false    10485760          null
--
-- and on `storage.objects`, exactly two policies for them, both correct:
--
--     "hi 1gq8viz_0"  INSERT  audio-uploads  foldername[1] = auth.uid()
--     "um 1y9e2oj_0"  INSERT  score-images   foldername[1] = auth.uid()
--
-- So **the live posture is sound and nobody could have known it from here.**
-- Those names are dashboard placeholders somebody typed; the policies that
-- stand between one musician's recordings and another's are called "hi" and
-- "um". Recreate this project from its migrations and neither exists, while
-- 009's four avatar policies do — an asymmetry that would look like the
-- buckets are fine.
--
-- **INSERT only, and that is right.** There is no SELECT, UPDATE or DELETE
-- policy for either bucket, so the anon key cannot read a page or a recording
-- even for its own owner. Every read is signed by the API with the service
-- role (`readable_audio_url`, `services/page_image.py`), which owner-scopes
-- the row first, and every delete goes through `discard_pages_of`. RLS with no
-- policy denies, so this fails closed. Do not add a SELECT policy to make
-- something convenient: it would let the bundle's anon key fetch objects
-- directly, and the API's ownership check would stop being the only way in.
--
-- Additive and idempotent. It changes nothing on a database that already looks
-- like the table above — which `intempo-dev` does — and it makes a database
-- built from these files look the same.
-- =============================================================

-- Sizes are the live values, not new limits. The API already refuses larger
-- payloads (`MAX_PAGE_BYTES` client-side, `_assert_within_quota` for takes),
-- but a signed upload URL goes straight to storage, so the bucket's own limit
-- is the only thing enforcing this against a client that does not ask nicely.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('score-images', 'score-images', false, 10485760),
  ('audio-uploads', 'audio-uploads', false, 52428800)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- Named versions of the two policies that already exist. Created only when an
-- equivalent is absent, so applying this to `intempo-dev` adds two policies
-- with the same predicate as "hi" and "um" — harmless, because Postgres ORs
-- permissive policies of the same command and both say exactly the same thing.
--
-- **The dashboard-named pair is deliberately not dropped here.** Dropping a
-- live policy is a change to who can write, and it wants a person watching the
-- upload path afterwards rather than a migration doing it unattended. Once
-- these two are in place they are redundant and can be removed by hand.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'score images are writable by their owner'
  ) THEN
    CREATE POLICY "score images are writable by their owner"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'score-images'
        AND (storage.foldername(name))[1] = (auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'recordings are writable by their owner'
  ) THEN
    CREATE POLICY "recordings are writable by their owner"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'audio-uploads'
        AND (storage.foldername(name))[1] = (auth.uid())::text
      );
  END IF;
END
$$;
