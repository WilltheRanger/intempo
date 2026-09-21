-- Where an analysis has got to, so a musician waiting on one can be told.
--
-- A take takes about 150 seconds on the deployed instance and the app showed
-- two static lines for all of it — no spinner, no bar, nothing that moved —
-- because `status` only ever says `processing`. There was nothing finer to
-- show. This is that finer thing: the runner writes the leg it is on, the API
-- hands it through, and the wait screen draws a bar that advances on real
-- transitions rather than on a timer pretending to be one.
--
-- Nullable and unconstrained on purpose. Rows written before this column
-- existed have no stage and must stay readable, a runner that dies mid-leg
-- leaves the last one it reached, and the app treats an unknown value as
-- "somewhere in the middle" rather than failing on it. A CHECK constraint here
-- would turn adding a pipeline step into a migration, which is how a label
-- ends up lying about what the code does.
alter table public.analyses
  add column if not exists stage text;

comment on column public.analyses.stage is
  'Pipeline leg for an in-flight analysis: fetching, checking, decoding, '
  'listening, aligning. Null before the runner starts or on rows predating '
  'the column. Advisory only — `status` remains the authority on whether an '
  'analysis is finished.';
