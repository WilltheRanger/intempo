-- =============================================================
-- 017_transcription_runs — a page cannot be read without end
-- =============================================================
--
-- Reading a page costs a vision-model call per page, on somebody's bill, and
-- until now nothing counted them.
--
-- `POST /v1/scores/{id}/transcribe` is guarded against *concurrency* — 006's
-- compare-and-set stops two taps starting two workers on one row — and against
-- nothing else. A signed-in account can wait for `done` and ask again, and
-- again, for as long as it likes. The free tier's three-analyses-a-month limit
-- does not touch this path: it counts rows in `analyses`, and a re-read creates
-- none. So the one endpoint in this API that spends real money on every call
-- was the one with no ceiling on how often it could be called.
--
-- **A cap on one page, not a quota on an account.** How many pieces a free
-- account may hold is a pricing question and nobody has answered it. How many
-- times it is reasonable to re-read *the same photograph* is not: a reading
-- that is still wrong on the twelfth attempt is not going to come right on the
-- thirteenth, and no musician has ever wanted one. The cap is therefore
-- generous enough to be invisible to a person and low enough to stop a loop.
--
-- **Default 0 rather than a backfill.** Every existing row has been read at
-- least once, so zero understates history — deliberately. The number this
-- column exists to bound is *further* reads, and starting everyone with a full
-- allowance is the direction that cannot take something away from a musician
-- who did nothing wrong.

-- `IF NOT EXISTS` because nothing here is applied by a deploy: someone runs it,
-- and whoever that is must be free to run it again without remembering whether
-- they already did. `test_readiness.py` enforces it.
--
-- Applied to the live project on 2026-09-09 via the Supabase MCP, having sat
-- unapplied for several sessions that each reported it as blocked on the owner.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS transcription_runs integer NOT NULL DEFAULT 0
  CHECK (transcription_runs >= 0);

COMMENT ON COLUMN scores.transcription_runs IS
  'How many times a worker has been sent to read this page. Bounds re-reads; the model call is billed per run. 0 for every row written before 017, which grants them a full allowance rather than charging them for history.';
