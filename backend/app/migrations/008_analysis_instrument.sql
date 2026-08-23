-- =============================================================
-- 008_analysis_instrument — the analysis learns what is being played
-- =============================================================
--
-- `services/analysis.analyze()` has taken a `double_bass` flag since Batch 3.
-- It turns on a high-pass filter and a lower onset-detection threshold, both
-- there because the low register is where onset detection is hardest: the
-- lowest string on a double bass vibrates at about 41 Hz, the note swells in
-- rather than snapping in, and most of its energy sits where the detector is
-- weakest.
--
-- **No caller has ever set it.** `analysis_runner` called
-- `analyze((y, sr), score, target_bpm)` and the flag defaulted false, so the
-- whole low-register path was dead code — in an app whose spec names double
-- bass as its initial instrument focus. Every bass player has been analysed
-- with the thresholds tuned for treble strings.
--
-- The value was already in the product. The app has had an `Instrument`
-- preference since the warmup shipped; it just never left the phone.
--
-- **The instrument is stored, not the flag.** The obvious column here is
-- `double_bass boolean`, and it would be wrong: that is the pipeline's current
-- *interpretation* of the instrument, and the interpretation is unsettled —
-- the spec asks for a high-pass in one place and a low-frequency boost in
-- another, and which is right needs real recordings and a musician's ear. A
-- column holding the fact survives that being decided; a column holding
-- today's conclusion would need a backfill the moment it changed, and could
-- never answer "how did cellists do" at all.
--
-- Nullable, with no default. A row written before this migration was analysed
-- without anyone saying what the instrument was, and "we do not know" is the
-- honest value for it — not 'violin', which would be a guess recorded as a
-- fact, and not the app's default, which would make every historical analysis
-- claim a preference nobody had expressed.

ALTER TABLE analyses ADD COLUMN instrument text
  CHECK (instrument IN ('violin', 'viola', 'cello', 'double_bass'));

COMMENT ON COLUMN analyses.instrument IS
  'What the musician plays, as stated by the client at submission. NULL when unknown — including every row written before the column existed. The pipeline reads it to decide onset-detection settings; it is deliberately the instrument and not a derived flag, because how the pipeline treats each instrument is still being tuned.';
