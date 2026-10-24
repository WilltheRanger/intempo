-- The advisory low-band instrumentation signal (`services
-- /instrumentation_signal.py`), stored on the take it was measured from.
--
-- **Advisory only, exactly as the module's docstring says.** Nothing in the
-- pipeline reads these columns and nothing downstream of a take's verdict
-- changes because of them — they exist so the API, and eventually the app,
-- can surface "this may not be solo violin" without re-decoding the take's
-- audio to find out.
--
-- Both nullable with no default. Null means one of three things, all
-- indistinguishable by design: a take recorded before this migration, a take
-- whose signal failed to compute (the worker never lets that fail a take —
-- see `analysis_runner.run_analysis`), or a deployment that has not applied
-- this migration yet. No backfill: the signal is only ever measured on the
-- audio already in hand while a take is being analysed.
alter table public.analyses
  add column if not exists low_band_ratio double precision,
  add column if not exists instrumentation_flagged boolean;

comment on column public.analyses.low_band_ratio is
  'Median share of spectral energy in 40-180 Hz, from services.'
  'instrumentation_signal.low_band_signal. Advisory; null on a take recorded '
  'before this column, one whose signal failed to compute, or an '
  'un-migrated deployment. Never read by the analysis pipeline.';

comment on column public.analyses.instrumentation_flagged is
  'Whether low_band_signal(...).flagged was true for this take -- sub-violin '
  'energy consistent with another instrument or a backing track. Advisory, '
  'never enforced: a flagged take may be exactly what the musician meant to '
  'record. Null under the same conditions as low_band_ratio.';
