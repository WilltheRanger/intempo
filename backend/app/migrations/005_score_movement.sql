-- =============================================================
-- 005_score_movement — which movement of a work a score is
-- =============================================================
--
-- Classical repertoire is organised by work *and* movement: "Sonata No. 1 in
-- G minor, BWV 1001" names four pieces, and a musician practising the Fuga is
-- not practising the Adagio. Without somewhere to record it the library shows
-- two identical rows and the musician has to remember which is which.
--
-- The app has always displayed it. `Piece.movement` is rendered on the piece
-- screen and in library rows, the fixtures fill it in, and the OCR review form
-- used to collect it — and then dropped it on the floor, because there was no
-- column to send it to. So this is the last of the app's fixture-only fields,
-- and the opposite decision to `progress`, which was deleted in the same
-- sweep: progress was a number nothing could compute, and this is a fact the
-- musician already knows and was already being asked for.
--
-- Nullable, with no default. Plenty of music has no movement — a caprice, an
-- étude, a song — and an empty string would make "no movement" and "movement
-- not recorded" the same value.

ALTER TABLE scores ADD COLUMN movement text
  CHECK (movement IS NULL OR length(movement) BETWEEN 1 AND 200);

COMMENT ON COLUMN scores.movement IS
  'Which movement of the work this score is, e.g. "I. Adagio". NULL for music that has none, and for scores added before this column existed.';
