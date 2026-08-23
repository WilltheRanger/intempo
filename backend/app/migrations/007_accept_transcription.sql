-- =============================================================
-- 007_accept_transcription — the musician says the reading is right,
--                            and the photograph is discarded
-- =============================================================
--
-- A page arrives as several megabytes of JPEG and leaves as a few kilobytes of
-- `score_json`. Keeping the photograph after the reading has been checked is
-- storage spent on a file with one remaining purpose — being compared against
-- the transcription — which has, by then, been done.
--
-- **Only after a person has looked.** Discarding on a successful OCR run would
-- be discarding on the pipeline's own say-so, and the pipeline is exactly the
-- thing the photograph exists to check. `ocr_confidence` is a model marking its
-- own homework and beat sums catch arithmetic, not wrong notes; neither is a
-- substitute for a musician reading the stave against the page. So the delete
-- is the consequence of an explicit acceptance and of nothing else.
--
-- Two columns rather than one, because these are two events and either can
-- happen without the other:
--
--   * `transcription_accepted_at` — the decision. A person said the reading is
--     right. Irreversible in the sense that matters (the photograph goes), but
--     the fact itself is just a timestamp.
--   * `page_image_discarded_at` — the consequence. Storage can refuse, and if
--     it does the acceptance still stands while the object is still there. One
--     column could not tell that state from a finished one, and would have the
--     app claiming a file was deleted that was not.
--
-- `source_image_url` is set to NULL by the same operation, which is what makes
-- the rest of the app cope with no further changes: migration 004 already made
-- it nullable, `_object_key_from` already returns None for it, and `image_url`
-- already comes back null. `page_image_discarded_at` is what distinguishes a
-- piece whose photograph was discarded from one that was typed in by hand —
-- both have no image, and telling a musician their scanned piece "was entered
-- by hand" would be a small lie with no upside.

ALTER TABLE scores ADD COLUMN transcription_accepted_at timestamptz;
ALTER TABLE scores ADD COLUMN page_image_discarded_at timestamptz;

COMMENT ON COLUMN scores.transcription_accepted_at IS
  'When the musician confirmed the transcription is correct. NULL until they do. Accepting is what authorises discarding the photograph.';
COMMENT ON COLUMN scores.page_image_discarded_at IS
  'When the source photograph was deleted from storage. NULL while it is still there — including for an accepted score whose delete failed.';
