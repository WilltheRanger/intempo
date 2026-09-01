-- =============================================================
-- 015_analysis_from_measure — which bar the take actually started at
-- =============================================================
--
-- **Practising a passage is what practice mostly is.** The app could already
-- *play* from any bar; it could only ever *record* from the first one, so
-- someone working on bar 40 of a concerto had to play the preceding
-- thirty-nine to be told anything about it.
--
-- Stored on the row rather than applied on the phone, for the reason
-- `skip_long_rests` (012) is: the analysis happens after the response is sent,
-- so the row is the only thing that survives to say what was played. A
-- timeline built from bar 1 for a take that began at bar 40 is misaligned at
-- every onset — and `alignment.py` accumulates durations, so the error does
-- not stay local, it moves every bar after it.
--
-- Null means "from the beginning", which is what every take recorded before
-- this column meant. Not defaulted to 1: a stored 1 and a stored null are the
-- same performance, and a nullable column that is sometimes absent is easier
-- to read honestly than one that claims a value nobody chose.

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS from_measure integer;

COMMENT ON COLUMN analyses.from_measure IS
  'The bar the musician entered on, as numbered on the page. Null = from the start.';

-- A bar number, or nothing. Zero and negatives are not bars.
ALTER TABLE analyses
  DROP CONSTRAINT IF EXISTS analyses_from_measure_positive;
ALTER TABLE analyses
  ADD CONSTRAINT analyses_from_measure_positive
  CHECK (from_measure IS NULL OR from_measure >= 1);
