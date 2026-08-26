-- =============================================================
-- 011_score_pages — a piece is more pages than one
-- =============================================================
--
-- `scores.source_image_url` is a single text column, so a scan has always been
-- one photograph. `TranscribeScreen` uploads `pages[0]` and says so on screen,
-- which is honest and is also the whole of the problem: **no orchestral part
-- is one page.** A musician who photographs three pages of a bass part gets
-- the first page transcribed and the other two thrown away.
--
-- `source_image_urls` is the ordered list of pages. Element order is page
-- order — the app fixes the ordering before it uploads anything
-- (`lib/scan/drag.ts`), so the server only ever sees a settled sequence and
-- has no ordering decision of its own to get wrong.
--
-- -------------------------------------------------------------------------
-- An array column, not a `score_pages` table, and the reason is the failure
-- mode rather than the schema
-- -------------------------------------------------------------------------
--
-- A table was the obvious shape: a row per page carries a per-page status, so
-- a scan where page 2 fails can keep pages 1 and 3 and say which one is
-- missing. That is exactly the design this project spent today deciding
-- against. A score assembled out of the pages that happened to read is a
-- timeline with a silent hole in the middle of it, and `alignment.py`
-- accumulates durations — so the verdict for every bar after the gap is
-- computed against music that is not there. It is the same mistake as a page
-- read at 0.00 being drawn as a score, one level up.
--
-- So a multi-page read is all-or-nothing, the failure names the page
-- (`page 2 of 3`), and the musician re-photographs that page. With no per-page
-- state to hold, a table holds nothing an array does not, and costs a join on
-- every read plus its own RLS policy.
--
-- -------------------------------------------------------------------------
-- `source_image_url` is kept, deliberately
-- -------------------------------------------------------------------------
--
-- Expand now, contract later. Dropping it in this migration would mean every
-- reader of it — create, the response model, delete, accept, the worker, the
-- stale-scan sweeper — had to move in the same commit, and the deployment
-- would be broken for the window between the migration running and the new
-- code serving. It is backfilled into the array here and drops in a later
-- migration once nothing reads it.
--
-- NULL rather than `'{}'` for a piece entered by hand: an empty array would
-- say "a scan with no pages in it", which is not a thing, while NULL says the
-- same thing `source_image_url` NULL has always said.

ALTER TABLE scores ADD COLUMN source_image_urls text[];

-- Every scan that exists today is a one-page scan, and this is what makes that
-- true of the new column as well without a code path for "old rows".
--
-- A score whose photograph was already discarded (007) has `source_image_url`
-- NULL and `page_image_discarded_at` set. It is left with a NULL array, which
-- is correct: there are no pages in storage. The page *count* of a discarded
-- scan is not recoverable and was never recorded — that is a gap this
-- migration does not invent a number for.
UPDATE scores
   SET source_image_urls = ARRAY[source_image_url]
 WHERE source_image_url IS NOT NULL;

COMMENT ON COLUMN scores.source_image_urls IS
  'The pages of this scan, in page order. NULL for a piece entered by hand or one whose photographs have been discarded. All-or-nothing: a scan whose pages did not all read is a failed scan, because a score assembled from the pages that happened to read has a silent hole in its timeline.';
COMMENT ON COLUMN scores.source_image_url IS
  'DEPRECATED — the first page only. Superseded by source_image_urls (011); kept while the code moves over, dropped in a later migration.';
