-- The analysis's working, kept with the take; and what `audio_reclaimed_at`
-- now covers.
--
-- ## diagnostics
--
-- The first real double-bass takes were refused — one as "not played" with 73
-- of its page's 75 notes detected, one as not lining up with 109 — and why
-- could only be read from a log line on the analysis worker, which nobody
-- diagnosing a take can reach. The row kept the verdict and nothing of how it
-- was reached.
--
-- So the worker stores what `analyze()` saw on the way: every attack the
-- detector reported, the reading of the page it chose, the alignment's timing
-- and coverage, the pitch evidence, and the rule that refused the take if one
-- did. The same values the decision used, not a second computation.
--
-- jsonb, nullable and diagnostic only, exactly as `capture` (026) is: nothing
-- in the pipeline or the app reads it, and its shape is the worker's to extend
-- without a migration each time. Null on every take before this, and on any
-- take whose write of it failed — which cannot cost the take its verdict,
-- because it is written separately and after.
alter table public.analyses
  add column if not exists diagnostics jsonb;

comment on column public.analyses.diagnostics is
  'What the analysis found on the way to its verdict: detected attack times '
  '(detected_s), the page reading chosen, alignment quality/timing/coverage, '
  'pitch evidence shares, the outcome and the refusal rule if any. Written '
  'after the verdict by the worker. Diagnostic only; never read by the '
  'pipeline or the app.';

-- ## audio_reclaimed_at
--
-- 019 defined this as the mark for a take that never got a verdict, because
-- that was the only path that deleted a WAV later than at once. A judged
-- take's WAV now goes an hour after its verdict rather than at it — a link to
-- it handed out a moment before the row named the Opus has to keep playing
-- until it expires (`take_archive.sweep_judged_originals`) — and it needs the
-- same mark for the same reason 019 gives: a sweep with a limit and no memory
-- stops sweeping. Nothing that reads the column changes meaning: the recording
-- endpoint refuses only a reclaimed row with no `playback_key`, and a judged
-- take always has one.
comment on column public.analyses.audio_reclaimed_at is
  'When the original WAV behind audio_url was deleted. For a take that never '
  'got a verdict, a day after it failed; for a judged take, an hour after its '
  'verdict, once no link to the WAV can still play (playback_key names the '
  'Opus it plays from instead). Null means the WAV has not been deleted yet. '
  'Set once and never cleared: audio_url keeps naming the upload this row was '
  'created from, and this says the object is gone.';
