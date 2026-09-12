-- =============================================================
-- 013_training_corrections — keep what the musician fixed, if they let us
-- =============================================================
--
-- Every scan this app has ever read has been corrected by a person and then
-- thrown away. `MeasureEditScreen` writes the corrected bar over the misread
-- one and keeps nothing about what it replaced; `POST /v1/scores/:id/accept`
-- then deletes the photograph. So the one thing this product generates that
-- nobody else can buy — *this page, read by this reader, wrong in this
-- specific way, and here is the right answer* — is destroyed at the moment it
-- is created, twice over.
--
-- **What a training example needs, and what this can actually supply.** The
-- useful triple is (image, prediction, correction). Two of the three are
-- already here and are being discarded; the third is the photograph, which
-- 007 deletes on accept for good reasons that still stand. So the retention
-- below is not a reversal of 007 — it is 007 with a consent gate in front of
-- it, and no consent means no change to any behaviour at all.
--
-- **Consent fails closed, unlike onboarding.** `users.onboarded_at` is allowed
-- to fail *open*: a slow or failed `/v1/me` opens the app rather than holding
-- it behind a network request (DECISIONS.md, 2026-08-25), because the cost of
-- guessing wrong is one screen shown twice. Here the cost of guessing wrong is
-- keeping a person's photographs without being told to, so NULL means no, an
-- unreadable row means no, and an error means no. There is no default and
-- there is no inferring it from anything else.

-- ----- consent -------------------------------------------------------------

-- When they agreed that their corrections may be kept and used to improve the
-- reader. NULL means they have not — which covers "never asked", "asked and
-- declined" and "agreed once and withdrew", because all three mean the same
-- thing to every caller: keep nothing.
--
-- A timestamp rather than a boolean because *when* is the part that matters
-- for a consent record. A boolean says a person agreed; a timestamp says when,
-- which is what makes it possible to answer "what were they agreeing to" after
-- the wording changes.
--
-- Withdrawal sets it back to NULL, and the API deletes what was retained in
-- the same request. It deliberately does not keep a "withdrawn_at" tombstone:
-- a row recording that someone once consented, after they have asked to be
-- forgotten, is the thing they asked not to exist.
ALTER TABLE users ADD COLUMN IF NOT EXISTS training_consent_at timestamptz;

COMMENT ON COLUMN users.training_consent_at IS
  'When the musician agreed their corrections may be kept to improve the reader. NULL means no — never asked, declined, and withdrawn are all NULL, because all three mean keep nothing.';

-- ----- what read the page --------------------------------------------------

-- Which reader produced the transcription, as configured at the time it ran —
-- e.g. `homr` or `homr,claude-sonnet-5`.
--
-- **Without this a correction cannot be attributed to anything.** "This bar was
-- read wrong" is not a training example; "this bar was read wrong *by this
-- reader*" is, and the difference decides whether the data survives the next
-- time the chain changes. The pipeline knows the chain (`_default_chain`) and
-- was throwing it away — `parse_sheet_music` returns a `ScoreJson` and no
-- telemetry, so the winning provider is genuinely not recoverable after the
-- fact and the *configured chain* is the honest thing to record.
--
-- Text and free-form on purpose, exactly as `transcription_stage` is: the names
-- follow the shape of `PROVIDER_REGISTRY`, and pinning them to an enum would
-- make adding a provider a migration.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS transcription_reader text;

COMMENT ON COLUMN scores.transcription_reader IS
  'The configured provider chain that read this page, e.g. "homr". The winning provider is not recoverable — parse_sheet_music returns no telemetry — so this records the chain, not the winner.';

-- Set when the photograph was kept *deliberately* at accept time, under
-- consent, instead of being deleted.
--
-- A third state, and it has to be distinguishable from the other two. After
-- 007 there were exactly two: `page_image_discarded_at` set means the object
-- is gone, and NULL means either nobody has accepted yet or the delete was
-- attempted and storage refused. Retention produces an accepted row whose
-- photograph is still there on purpose, which reads identically to that second
-- case — and "kept because a person agreed" and "still here because the delete
-- failed" want opposite things done about them.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS page_image_retained_at timestamptz;

COMMENT ON COLUMN scores.page_image_retained_at IS
  'When the photograph was kept at accept time under training consent rather than discarded. Distinct from a NULL discarded_at, which also covers a delete that storage refused.';

-- ----- the corrections themselves ------------------------------------------

CREATE TABLE IF NOT EXISTS training_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cascades from both parents, and both cascades are the point rather than
  -- tidiness. Deleting an account or a piece is a person saying "remove this",
  -- and a training corpus that survives the deletion of the thing it was
  -- derived from is the corpus becoming a way to keep data someone deleted.
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score_id uuid NOT NULL REFERENCES scores(id) ON DELETE CASCADE,

  -- Which bar was corrected. NULL for a change that is not scoped to one —
  -- the clef, the key, the time signature — which are corrections worth
  -- keeping and have no measure to name.
  measure_number integer CHECK (measure_number IS NULL OR measure_number >= 1),

  -- The bar as the reader wrote it, and as the musician fixed it.
  --
  -- **One row per corrected measure, holding that measure, not the whole
  -- score.** A page is seventy bars and a correction touches one or two; a
  -- before/after pair of whole `ScoreJson` documents per correction stores the
  -- other sixty-eight twice to say nothing about them, and then the training
  -- signal has to be diffed back out of it anyway. The measure is the unit the
  -- app corrects in and the unit a reader gets wrong.
  --
  -- **Either side may be NULL, and that is the interesting case.** A bar the
  -- reader missed altogether has no `before`; a bar it invented — a rehearsal
  -- mark counted as a measure, which this pipeline has actually done — has no
  -- `after`. Writing an empty measure instead would say the reader emitted a
  -- bar with no notes in it, which is a different mistake with a different fix.
  -- Note SQL NULL here, not the JSON value `null`: absent, not "present and
  -- empty".
  before jsonb,
  after jsonb,
  CONSTRAINT training_corrections_has_a_side
    CHECK (before IS NOT NULL OR after IS NOT NULL),

  -- The chain that produced `before`, copied from the score at the moment the
  -- correction is written rather than joined at read time — the score can be
  -- re-transcribed by a different chain later, and that must not silently
  -- re-attribute a correction to a reader that never made the mistake.
  reader text,

  -- The page the bar was read from, as a storage object key.
  --
  -- **A key, and not a crop.** The useful thing would be the region of the page
  -- this bar occupies; homr knows it, and neither `musicxml.py` nor the schema
  -- carries it, so the finest pointer available is the page plus the bar
  -- number. Whoever builds the training set will have to re-locate the bar on
  -- the page. Recording the honest pointer now is what makes that possible
  -- later; inventing a crop we do not have would not.
  --
  -- NULL when the photograph is already gone — a correction made after
  -- accepting still carries what changed, and is still worth keeping.
  page_image_key text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- The two questions asked of this table: everything for one score (when a
-- correction is written, and when a piece is deleted), and everything for one
-- user (when consent is withdrawn).
CREATE INDEX IF NOT EXISTS training_corrections_score_idx
  ON training_corrections (score_id);
CREATE INDEX IF NOT EXISTS training_corrections_user_idx
  ON training_corrections (user_id, created_at DESC);

COMMENT ON TABLE training_corrections IS
  'What a musician fixed in a reading, kept only with their consent. One row per corrected measure. Deleted with the score, the account, or the consent.';

-- Same shape as every other table here: the owner can see and remove their
-- own, and the backend writes with the service-role key, which bypasses RLS.
--
-- **No INSERT policy, deliberately**, matching the note about `users` in 002:
-- a client that could write these directly could attribute a correction to a
-- reader that never made it, which is the one thing that would make the corpus
-- worse than having none.
ALTER TABLE training_corrections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'training_corrections'
      AND policyname = 'owner can read own corrections'
  ) THEN
    CREATE POLICY "owner can read own corrections"
      ON training_corrections FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'training_corrections'
      AND policyname = 'owner can delete own corrections'
  ) THEN
    CREATE POLICY "owner can delete own corrections"
      ON training_corrections FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END
$$;
