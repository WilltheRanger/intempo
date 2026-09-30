-- =============================================================
-- 029 — the saxophone: alto_sax and tenor_sax
-- =============================================================
--
-- **The first wind instruments.** Until now `instrument` was the four bowed
-- strings (008 on `analyses`, 009 on `users`), and both columns refuse
-- anything else. The owner asked for winds, saxophone first (2026-09-30).
-- Alto and tenor are the two most played, and both are transposing: an alto
-- sounds a major sixth below what is written, a tenor a major ninth below.
-- The pipeline reads the written part and listens for the sounding pitch
-- (`services/analysis._TRANSPOSE`); the column only has to allow the value.
--
-- **Replaced by name, on both tables, in one file.** 008 and 009 declared the
-- constraints inline, so Postgres named them `<table>_instrument_check`
-- (read from the live project, 2026-09-30, before writing this). A value
-- allowed on `analyses` and not on `users` would give a saxophonist a take
-- that submits and a profile that will not save — which is why
-- `test_column_vocabularies` holds every table's latest declaration to the
-- same list.
--
-- Both columns stay nullable with no default, as they were. Widening a CHECK
-- cannot invalidate a row that satisfied the narrower one.

ALTER TABLE analyses DROP CONSTRAINT IF EXISTS analyses_instrument_check;
ALTER TABLE analyses ADD CONSTRAINT analyses_instrument_check
  CHECK (instrument IN ('violin', 'viola', 'cello', 'double_bass', 'alto_sax', 'tenor_sax'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_instrument_check;
ALTER TABLE users ADD CONSTRAINT users_instrument_check
  CHECK (instrument IN ('violin', 'viola', 'cello', 'double_bass', 'alto_sax', 'tenor_sax'));
