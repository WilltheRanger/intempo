-- =============================================================
-- 014_pending_uploads — an object with no row is an object nobody can delete
-- =============================================================
--
-- **The hole this closes has been known and written down since 2026-08-24**,
-- in CLAUDE.md, under its own heading: *"Known hole, unfixed: orphaned
-- uploads. An upload that never becomes a score row is permanent and
-- unreachable — the only storage deletion is reached from POST /:id/accept
-- keyed off an existing row, so backing out of the naming screen, a failed
-- save, or a retried transcribe each leave a photograph in the bucket forever.
-- This contradicts the rule above it; it needs a lifecycle decision, not a
-- patch."*
--
-- The rule it contradicts is the one directly above it: *"The photograph is
-- deleted only when a person accepts the reading."* That rule is about who
-- gets to decide, and it is right. It says nothing about photographs that
-- never became a reading at all, and those are the ones with no path out.
--
-- Three ordinary things produce one: backing out of the naming screen after
-- the upload has finished, a save that fails after the bytes landed, and a
-- transcribe retried against a fresh key. None is an error. All three leave a
-- musician's photograph of their own sheet music in storage with no row
-- pointing at it, no screen that can reach it, and no request that can remove
-- it — including, and this is the part that matters, a request from them.
--
-- **Why a table and not a bucket walk.** The obvious sweeper lists the bucket
-- and deletes what no `scores` row references. It works and it scales badly:
-- objects live under `{user_id}/{uuid}`, so listing means one request per
-- user folder per sweep, forever, mostly to be told there is nothing to do.
--
-- Recording the upload instead makes the sweep an indexed query on a table
-- that is empty in the steady state. It also states the invariant plainly,
-- which the bucket walk never could: **every object in these buckets has a row
-- somewhere** — a `scores` row because it became a piece, an `analyses` row
-- because it became a take, a `users.avatar_url` because it became a face, or
-- a row here because it has not become anything yet. An object with no row is
-- now a bug rather than a Tuesday.

CREATE TABLE IF NOT EXISTS pending_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Whose it is. Not for permissions — the sweeper runs as the service role —
  -- but so that deleting an account can take its unclaimed uploads with it,
  -- which is exactly the case that has been leaking.
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,

  -- Which bucket, because all three have this problem. A page photograph, a
  -- take's audio and an avatar are minted the same way and abandoned the same
  -- way; only the page has ever been talked about.
  bucket text NOT NULL,
  object_key text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- One row per object. A retried upload mints a new key, so a collision here
  -- would mean the same key handed out twice, which is worth failing on.
  UNIQUE (bucket, object_key)
);

-- The only question the sweeper asks: what is old and still unclaimed.
CREATE INDEX IF NOT EXISTS pending_uploads_age_idx ON pending_uploads (created_at);

COMMENT ON TABLE pending_uploads IS
  'Uploads that have been signed for but not yet claimed by a row. Deleted when claimed, or swept when they are old enough that nothing is coming.';

-- No policies beyond the switch. Nothing client-side reads or writes this: it
-- is minted by the upload endpoint and cleared by the endpoints that consume
-- an object, both of which use the service-role key and bypass RLS. A client
-- that could delete rows here could hide an object from the sweeper forever,
-- which is the one thing this table exists to prevent.
ALTER TABLE pending_uploads ENABLE ROW LEVEL SECURITY;
