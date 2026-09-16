-- =============================================================
-- 019_take_audio_reclaim — the WAV a take never earned a verdict for
-- =============================================================
--
-- **Recovered from the live project, not written here.** This column exists on
-- `intempo-dev` and was applied on 2026-09-13 as
-- `20260913024401 019_take_audio_reclaim`; no file in this repository created
-- it and nothing in the tree referenced it. The statements below are the ones
-- the project actually ran, read back out of
-- `supabase_migrations.schema_migrations`, so the file matches what is
-- deployed rather than what someone would write today.
--
-- **Why that matters more than the column does.** `tools/check-migrations.py`
-- applies every file here in order to an empty database, and CLAUDE.md §1
-- calls it the one check that can catch SQL which does not run. It was passing
-- against a schema two days out of date: 001-018 build a database that is not
-- the one production has, so the gate agreed with itself rather than with
-- Supabase. A restore, a second environment, or a fresh project built from
-- this repository would have come up without the column.
--
-- Nothing in the application reads or writes `audio_reclaimed_at` yet. That is
-- the other half of the same drift — the schema moved and the code did not —
-- and it is left exactly as found. This file changes no database; it only
-- makes the repository able to rebuild the one that exists.
--
-- ## What it is for
--
-- 018 added `playback_key`: the compressed copy kept once a take has been
-- judged, after which the original WAV can go. A take that is *never* judged
-- has no such copy, and its WAV is still 96 KB a second. Deleting it needs
-- somewhere to say so, because `audio_url` cannot: it is also the retry key
-- for `POST /v1/analyses`, so it has to keep naming the upload the row was
-- created from even once the object behind it is gone.
--
-- Null is the ordinary state and means the WAV was not reclaimed — the take
-- was judged (see `playback_key`), or it is still running, or the grace period
-- has not passed. Set once and never cleared.

-- `IF NOT EXISTS` because nothing here is applied by a deploy: someone runs it,
-- and whoever that is must be free to run it again without remembering whether
-- they already did. `test_readiness.py` enforces it. The live project already
-- has this column, so this is a no-op there and is meant to be.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS audio_reclaimed_at timestamptz;

COMMENT ON COLUMN analyses.audio_reclaimed_at IS
  'When the original WAV behind audio_url was deleted for a take that never got a verdict. Null means it was not — either the take was judged (see playback_key), or it is still running, or the grace period has not passed. Set once and never cleared: audio_url keeps naming the upload this row was created from, and this says the object is gone.';
