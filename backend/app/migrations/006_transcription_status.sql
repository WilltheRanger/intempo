-- =============================================================
-- 006_transcription_status — a score can exist before it has been read
-- =============================================================
--
-- `POST /v1/scores` used to run OCR inline: upload the page, wait, get a row
-- back with notes in it. On a laptop against a warm server that was ten or
-- fifteen seconds and merely slow. On a phone, against a free-tier host that
-- sleeps, it is a single request that can run past a minute — and a request is
-- the wrong thing to hang that on. Background the app and the fetch is killed;
-- lose signal and the work is lost with the connection; and for the whole of
-- it the musician has a spinner and no idea whether anything is happening.
--
-- So a score is now inserted immediately with no notes in it, and a worker
-- fills them in — the same shape `analyses` has had since Batch 4, for the
-- same reason.
--
-- `score_json` stays NOT NULL. A queued score gets an empty transcription
-- (`measures: []`), which is not a placeholder invented for this migration:
-- it is exactly what a hand-entered piece holds, and every reader in the app
-- already copes with it, because "a piece with no notes yet" has been a real
-- state since 004. What is new is being able to say *why* there are none.
--
-- `transcription_status` defaults to 'done' so that every row written before
-- this migration — all of which were transcribed inline, successfully, before
-- they were inserted at all — describes itself correctly without a backfill.

ALTER TABLE scores ADD COLUMN transcription_status text NOT NULL DEFAULT 'done'
  CHECK (transcription_status IN ('queued', 'reading', 'done', 'failed'));

-- Which step it reached, in the worker's own words, for the screen that is
-- watching. Free text rather than an enum: the stages are a property of the
-- OCR pipeline's shape, which changes with the provider chain, and a CHECK
-- constraint on them would turn adding a provider into a migration.
ALTER TABLE scores ADD COLUMN transcription_stage text;

-- Why it failed, when it did. NULL at every other time, including after a
-- retry succeeds — a stale reason under a finished score would be read as a
-- warning about the notes above it.
ALTER TABLE scores ADD COLUMN transcription_error text;

COMMENT ON COLUMN scores.transcription_status IS
  'queued → reading → done | failed. Always done for a hand-entered piece and for every score written before OCR moved to a worker.';
COMMENT ON COLUMN scores.transcription_stage IS
  'The step the worker last reported, for a client polling the row. NULL once finished.';
COMMENT ON COLUMN scores.transcription_error IS
  'Why transcription failed, in a sentence fit to show a musician. NULL unless transcription_status = failed.';

-- The worker polls for its own row by id, but a client watching a scan asks
-- "is anything of mine still reading" — cheap to answer, and only over the
-- handful of rows that are.
CREATE INDEX scores_unfinished_idx ON scores(user_id)
  WHERE transcription_status IN ('queued', 'reading');
