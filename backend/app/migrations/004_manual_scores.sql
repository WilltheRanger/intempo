-- =============================================================
-- 004_manual_scores — a piece can exist without a photograph
-- =============================================================
--
-- `scores.source_image_url` was NOT NULL because every score arrived the same
-- way: photograph it, OCR it, store the URL it came from. That made the column
-- a record of provenance, and NOT NULL was the correct constraint for as long
-- as there was exactly one provenance.
--
-- There are now two. A musician working from a book they don't want to
-- photograph — or one whose page the OCR can't read — needs the piece in their
-- library anyway, with a title, a composer and a tempo to practise against.
-- Such a row has no source image, and NULL is the honest way to say so:
-- the alternative was a sentinel string, which would have made every reader of
-- this column responsible for knowing which strings are real URLs.
--
-- `_object_key_from()` in routers/scores.py already returns None for anything
-- that isn't a storage URL, so a NULL flows through the display-signing path
-- as "no image" without a special case.
--
-- Reversible: rows added before this migration all have a value, so the
-- constraint can be restored once no NULLs remain.

ALTER TABLE scores ALTER COLUMN source_image_url DROP NOT NULL;

COMMENT ON COLUMN scores.source_image_url IS
  'Signed upload URL the sheet music arrived on, or NULL for a piece entered by hand. Historical: the URL itself expires minutes after upload — routers/scores.py re-signs a fresh download URL for display.';
