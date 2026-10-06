-- =============================================================
-- 030 — row-level security asks who you are once per query
-- =============================================================
--
-- **From the live project's own advisor** (`auth_rls_initplan`, 13 policies,
-- read 2026-10-05). A policy that compares a column with `auth.uid()` calls
-- the function for every row it considers; written `(select auth.uid())`,
-- Postgres evaluates it once as an InitPlan and compares every row with the
-- result. Same answer — `auth.uid()` reads the request's JWT and cannot
-- change within a statement — at a fraction of the cost once a table is
-- large. Supabase's documented form:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- **Altered in place, not dropped and recreated.** `ALTER POLICY` changes
-- only the expressions: name, command, roles and permissiveness stay exactly
-- as 002, 009, 013, 021, 022 and 024 left them, and there is no moment in
-- which a table has fewer policies than it should. Each expression below is
-- the one `pg_policies` held — read from the live project and from a database
-- built from 001–029, which agreed character for character — with
-- `auth.uid()` wrapped and nothing else touched.
--
-- **And an index under five foreign keys** (`unindexed_foreign_keys`). Each
-- is the column a cascade or a join walks: deleting an account cascades
-- through `pending_uploads` and `verdict_corrections` by `user_id`, and the
-- teacher tables join on the other three.

ALTER POLICY "owner full access on analyses" ON public.analyses
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "teacher reads assignment analyses" ON public.analyses
  USING (
    assignment_id IS NOT NULL
    AND assignment_id IN (
      SELECT assignments.id FROM assignments
      WHERE assignments.teacher_user_id = (select auth.uid())
    )
  );

ALTER POLICY "student select own assignments" ON public.assignments
  USING ((select auth.uid()) = student_user_id);

ALTER POLICY "teacher full access on own assignments" ON public.assignments
  USING ((select auth.uid()) = teacher_user_id)
  WITH CHECK ((select auth.uid()) = teacher_user_id);

ALTER POLICY "owner full access on scores" ON public.scores
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "studio members can read shared scores" ON public.scores
  USING (
    shared_with_studio IS NOT NULL
    AND shared_with_studio IN (
      SELECT users.studio_id FROM users
      WHERE users.id = (select auth.uid())
    )
  );

ALTER POLICY "studio members can read" ON public.studios
  USING (
    id IN (
      SELECT users.studio_id FROM users
      WHERE users.id = (select auth.uid())
    )
  );

ALTER POLICY "studio owner full access" ON public.studios
  USING ((select auth.uid()) = owner_user_id)
  WITH CHECK ((select auth.uid()) = owner_user_id);

ALTER POLICY "user inserts own sync events" ON public.sync_events
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "owner can delete own corrections" ON public.training_corrections
  USING ((select auth.uid()) = user_id);

ALTER POLICY "owner can read own corrections" ON public.training_corrections
  USING ((select auth.uid()) = user_id);

ALTER POLICY "users select self" ON public.users
  USING ((select auth.uid()) = id);

ALTER POLICY "owner inserts own verdict corrections" ON public.verdict_corrections
  WITH CHECK ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS assignments_score_idx ON public.assignments (score_id);
CREATE INDEX IF NOT EXISTS assignments_submitted_analysis_idx ON public.assignments (submitted_analysis_id);
CREATE INDEX IF NOT EXISTS pending_uploads_user_idx ON public.pending_uploads (user_id);
CREATE INDEX IF NOT EXISTS studios_owner_idx ON public.studios (owner_user_id);
CREATE INDEX IF NOT EXISTS verdict_corrections_user_idx ON public.verdict_corrections (user_id);
