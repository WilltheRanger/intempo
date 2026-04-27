-- =============================================================
-- 002_rls_policies.sql — Row-level security (Batch 1)
--
-- Implements the prose RLS outline at the bottom of
-- intempo-combined.md §2 ("Row-level security (Supabase RLS)
-- — outline"). Enable RLS on every table; service-role bypasses
-- all policies by default in Supabase, so admin / sweeper code
-- using the service-role key keeps full access.
-- =============================================================

-- ----- studios -----
ALTER TABLE studios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "studio owner full access"
  ON studios FOR ALL
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "studio members can read"
  ON studios FOR SELECT
  USING (id IN (SELECT studio_id FROM users WHERE users.id = auth.uid()));

-- ----- users -----
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select self"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users update self"
  ON users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Note: INSERT into users for first-touch provisioning happens via the
-- service-role key from the backend's /v1/me handler (which bypasses RLS).
-- We deliberately do NOT add a self-INSERT policy here, so a malicious
-- client cannot mint user rows directly with the anon key.

-- ----- scores -----
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner full access on scores"
  ON scores FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "studio members can read shared scores"
  ON scores FOR SELECT
  USING (
    shared_with_studio IS NOT NULL
    AND shared_with_studio IN (SELECT studio_id FROM users WHERE users.id = auth.uid())
  );

-- ----- assignments -----
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher full access on own assignments"
  ON assignments FOR ALL
  USING (auth.uid() = teacher_user_id)
  WITH CHECK (auth.uid() = teacher_user_id);

CREATE POLICY "student select own assignments"
  ON assignments FOR SELECT
  USING (auth.uid() = student_user_id);

-- Students can transition status assigned -> in_progress -> submitted.
-- A trigger (added in Batch 12 when the teacher tier ships) will enforce
-- the exact transition graph; for now the policy gates write access to
-- the student's own row only.
CREATE POLICY "student update status on own assignments"
  ON assignments FOR UPDATE
  USING (auth.uid() = student_user_id)
  WITH CHECK (auth.uid() = student_user_id);

-- ----- analyses -----
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner full access on analyses"
  ON analyses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "teacher reads assignment analyses"
  ON analyses FOR SELECT
  USING (
    assignment_id IS NOT NULL
    AND assignment_id IN (
      SELECT id FROM assignments WHERE teacher_user_id = auth.uid()
    )
  );

-- ----- verdict_corrections -----
ALTER TABLE verdict_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner inserts own verdict corrections"
  ON verdict_corrections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No SELECT policy: only the service-role retraining pipeline reads this
-- table, and service-role bypasses RLS by design.

-- ----- sync_events -----
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user inserts own sync events"
  ON sync_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No SELECT policy for the same reason as verdict_corrections — only the
-- service-role audit/sync reconciler reads it.
