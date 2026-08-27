-- =============================================================
-- 012_analysis_skip_long_rests — a take that skipped the long rests
-- =============================================================
--
-- An orchestral part is mostly waiting. Practising the notes around a
-- twenty-bar rest means skipping it, and the app now offers to — but a musician
-- who skips it plays the bar after it twenty bars early, while the analysis
-- still expects the silence.
--
-- **Measured on an otherwise perfect take**, played exactly on the grid with
-- the rest skipped:
--
--     bars of rest   waited through        skipped
--     2              quality 1.000         quality 0.000
--     4              quality 1.000         quality 0.000
--     12             quality 1.000         quality 0.000
--     20             quality 1.000         quality 0.000
--
-- Every note still matched. The shape simply cannot be explained by a steady
-- grid, so the verdict becomes `alignment_failed` — "check you're on the right
-- piece" — on a take that was played correctly. Note that the two-bar case is
-- as broken as the twenty-bar one: this is not about how long the rest is.
--
-- So the flag has to reach the worker, which shortens the score the same way
-- before building the timeline (`services/long_rests.py`, against the contract
-- in `fixtures/practice/long_rests.json` that the app is tested against too).
--
-- **Boolean, not the number of bars skipped.** The bars are derivable from the
-- score and the rule, and storing them would be a second copy of an answer that
-- has to match — the failure this project keeps finding. What the row records
-- is the musician's choice, which is the thing that cannot be recomputed.
--
-- Nullable with a false default: every take recorded before this column, and
-- every client that has never heard of it, waited through the rests. The API
-- writes the key **only when it is true**, so a deployment that has not run
-- this migration is untouched until someone actually skips a rest — and then
-- the insert fails loudly rather than the take being judged against silence
-- nobody played.

alter table public.analyses
  add column if not exists skip_long_rests boolean not null default false;

comment on column public.analyses.skip_long_rests is
  'The musician practised with runs of rest shortened; the worker shortens the score the same way before building the expected timeline.';
