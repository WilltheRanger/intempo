-- =============================================================
-- 010_transcription_call_id — what Modal was asked to do, and how to ask again
-- =============================================================
--
-- A page dispatched to Modal leaves no trace anywhere except the `scores` row,
-- and Modal is the thing that writes that row. So when a Modal run dies
-- *before its first write* — a bad secret, an image that will not import, an
-- OOM at start-up — there is nothing. No stage, no error, no log on the API
-- side beyond "being read on Modal", which was true. The row sits in `reading`
-- until the sweeper gives up and writes a sentence it guessed:
--
--     Reading this page stopped before it finished.
--
-- That sentence has been shown to a musician twice now for two entirely
-- different faults, and neither time did anyone learn anything. This column is
-- the missing thread back: `fn.spawn()` returns a call id, and Modal will
-- answer questions about a call id long after the container is gone.
--
-- **Not a status, and deliberately not one.** It says nothing about whether the
-- read worked. It is the handle that lets the sweeper *ask*, so a read that
-- failed on Modal can be reported with Modal's own reason instead of ours, and
-- a read still legitimately running can be left alone rather than failed for
-- taking a while.
ALTER TABLE scores ADD COLUMN transcription_call_id text;

COMMENT ON COLUMN scores.transcription_call_id IS
  'Modal FunctionCall id for the read in flight, so its outcome can be asked for after the container is gone. NULL when the page was read in-process, or before this column existed.';
