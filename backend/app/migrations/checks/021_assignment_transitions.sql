-- =============================================================
-- Behavioural check for 021_assignment_transitions
-- =============================================================
--
-- Run by `tools/check-migrations.py` after the whole set has applied. A file in
-- this directory is **not a migration** — it is never applied to a project, and
-- `migrations/*.sql` does not glob it, so nothing that reads the migration set
-- (`test_readiness.py`, `test_rls_invariants.py`, the gate's own applier) sees
-- it as one.
--
-- It exists because `021` is the first thing in this schema whose behaviour is
-- not visible in its own text. `test_rls_invariants.py` can read a migration
-- and say whether a policy is scoped to its owner; nothing static can say
-- whether a trigger rejects `archived -> assigned`. `readiness.py` cannot see
-- it either: it probes columns and tables over REST, and a trigger is neither.
--
-- Every assertion below is a rule stated in 021's header. If one stops being
-- true, this fails where the migration is applied rather than where an
-- assignment is next written.
--
-- Fixtures are inserted and left behind, like the migrations gate's own
-- database: a failure is worth inspecting. That database is a throwaway
-- `postgres:16` in CI and an empty local Postgres otherwise.
--
-- Every local is `v_`-prefixed. plpgsql resolves an ambiguous name between a
-- variable and a column as an error, and half these names are columns on the
-- table under test.

DO $$
DECLARE
  v_teacher       uuid := '11111111-1111-1111-1111-111111111111';
  v_student       uuid := '22222222-2222-2222-2222-222222222222';
  v_outsider      uuid := '33333333-3333-3333-3333-333333333333';
  v_studio        uuid := '44444444-4444-4444-4444-444444444444';
  v_other_studio  uuid := '44444444-4444-4444-4444-4444444444ff';
  v_score         uuid := '55555555-5555-5555-5555-555555555555';
  v_other_score   uuid := '55555555-5555-5555-5555-5555555555ff';
  v_take          uuid := '66666666-6666-6666-6666-666666666666';
  v_outsider_take uuid := '77777777-7777-7777-7777-777777777777';
  v_row           uuid;
  v_observed      public.assignment_status;
  v_rejected      boolean;
  v_edge          record;
BEGIN
  -- ---------------------------------------------------------
  -- Fixtures. `public.users.id` is keyed to `auth.users.id` (003), and
  -- `studios.owner_user_id` references `users` while `users.studio_id`
  -- references `studios` — so the teacher is inserted unaffiliated and
  -- promoted once the studio exists. The role/tier CHECK in 001 requires role,
  -- tier and studio_id to move together.
  -- ---------------------------------------------------------
  INSERT INTO auth.users (id, email) VALUES
    (v_teacher,  'teacher@check.invalid'),
    (v_student,  'student@check.invalid'),
    (v_outsider, 'outsider@check.invalid');

  INSERT INTO public.users (id, email) VALUES
    (v_teacher,  'teacher@check.invalid'),
    (v_student,  'student@check.invalid'),
    (v_outsider, 'outsider@check.invalid');

  INSERT INTO public.studios (id, owner_user_id, name, invite_code) VALUES
    (v_studio,       v_teacher, 'Check Studio',  'CHK001'),
    (v_other_studio, v_teacher, 'Second Studio', 'CHK002');

  UPDATE public.users
     SET role = 'teacher', tier = 'teacher', studio_id = v_studio
   WHERE id = v_teacher;
  UPDATE public.users
     SET tier = 'student_via_teacher', studio_id = v_studio
   WHERE id = v_student;

  INSERT INTO public.scores (id, user_id, title, source_image_url, score_json) VALUES
    (v_score,       v_student, 'Check Study',  'https://example.invalid/p1.jpg', '{}'::jsonb),
    (v_other_score, v_student, 'Second Study', 'https://example.invalid/p2.jpg', '{}'::jsonb);

  INSERT INTO public.analyses (id, user_id, score_id, audio_url, target_bpm, bpm_source) VALUES
    (v_take,          v_student,  v_score, 'https://example.invalid/t.wav', 92, 'manual'),
    (v_outsider_take, v_outsider, v_score, 'https://example.invalid/o.wav', 92, 'manual');

  -- ---------------------------------------------------------
  -- 1. Every edge the graph allows is allowed, and lands where it says.
  -- ---------------------------------------------------------
  FOR v_edge IN
    SELECT * FROM (VALUES
      ('assigned',    'in_progress'),
      ('assigned',    'submitted'),
      ('assigned',    'archived'),
      ('in_progress', 'submitted'),
      ('in_progress', 'archived'),
      ('submitted',   'reviewed'),
      ('submitted',   'in_progress'),   -- back for another take: the retry loop
      ('submitted',   'archived'),
      ('reviewed',    'in_progress'),   -- next week, same passage
      ('reviewed',    'archived')
    ) AS t(from_status, to_status)
  LOOP
    DELETE FROM public.assignments WHERE public.assignments.studio_id = v_studio;
    INSERT INTO public.assignments
      (studio_id, teacher_user_id, student_user_id, score_id, target_bpm,
       status, submitted_analysis_id, reviewed_at)
    VALUES
      (v_studio, v_teacher, v_student, v_score, 92,
       v_edge.from_status::public.assignment_status,
       CASE WHEN v_edge.from_status IN ('submitted', 'reviewed') THEN v_take END,
       CASE WHEN v_edge.from_status = 'reviewed' THEN now() END)
    RETURNING id INTO v_row;

    UPDATE public.assignments
       SET status = v_edge.to_status::public.assignment_status,
           submitted_analysis_id = COALESCE(
             submitted_analysis_id,
             CASE WHEN v_edge.to_status IN ('submitted', 'reviewed') THEN v_take END),
           reviewed_at = COALESCE(
             reviewed_at,
             CASE WHEN v_edge.to_status = 'reviewed' THEN now() END)
     WHERE id = v_row;

    SELECT status INTO v_observed FROM public.assignments WHERE id = v_row;
    IF v_observed <> v_edge.to_status::public.assignment_status THEN
      RAISE EXCEPTION 'edge % -> % did not land: row reads %',
        v_edge.from_status, v_edge.to_status, v_observed;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------
  -- 2. Every edge the graph does not allow is rejected: archived is terminal,
  --    a review needs a submission, and nothing reopens as `assigned`.
  -- ---------------------------------------------------------
  FOR v_edge IN
    SELECT * FROM (VALUES
      ('assigned',    'reviewed'),      -- reviewed without ever being submitted
      ('in_progress', 'assigned'),
      ('in_progress', 'reviewed'),      -- skips the submission the review is of
      ('submitted',   'assigned'),
      ('reviewed',    'assigned'),
      ('reviewed',    'submitted'),
      ('archived',    'assigned'),      -- archived is terminal
      ('archived',    'in_progress'),
      ('archived',    'submitted'),
      ('archived',    'reviewed')
    ) AS t(from_status, to_status)
  LOOP
    DELETE FROM public.assignments WHERE public.assignments.studio_id = v_studio;
    INSERT INTO public.assignments
      (studio_id, teacher_user_id, student_user_id, score_id, target_bpm,
       status, submitted_analysis_id, reviewed_at)
    VALUES
      (v_studio, v_teacher, v_student, v_score, 92,
       v_edge.from_status::public.assignment_status,
       CASE WHEN v_edge.from_status IN ('submitted', 'reviewed') THEN v_take END,
       CASE WHEN v_edge.from_status = 'reviewed' THEN now() END)
    RETURNING id INTO v_row;

    v_rejected := false;
    BEGIN
      UPDATE public.assignments
         SET status = v_edge.to_status::public.assignment_status,
             submitted_analysis_id = COALESCE(
               submitted_analysis_id,
               CASE WHEN v_edge.to_status IN ('submitted', 'reviewed') THEN v_take END),
             reviewed_at = COALESCE(
               reviewed_at,
               CASE WHEN v_edge.to_status = 'reviewed' THEN now() END)
       WHERE id = v_row;
    EXCEPTION WHEN check_violation THEN
      v_rejected := true;
    END;

    IF NOT v_rejected THEN
      RAISE EXCEPTION
        'edge % -> % was accepted; the graph in 021 says it is not a transition',
        v_edge.from_status, v_edge.to_status;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------
  -- 3. A no-op status is not a transition, so a field edit is allowed — the
  --    teacher rewriting their own instructions must not have to move status.
  -- ---------------------------------------------------------
  DELETE FROM public.assignments WHERE public.assignments.studio_id = v_studio;
  INSERT INTO public.assignments
    (studio_id, teacher_user_id, student_user_id, score_id, target_bpm, status)
  VALUES (v_studio, v_teacher, v_student, v_score, 92, 'assigned')
  RETURNING id INTO v_row;

  UPDATE public.assignments
     SET teacher_instructions = 'Bars 40-48, dotted rhythm, quarter = 92.',
         due_at = now() + interval '7 days'
   WHERE id = v_row;

  IF NOT EXISTS (
    SELECT 1 FROM public.assignments
     WHERE id = v_row AND teacher_instructions IS NOT NULL AND status = 'assigned'
  ) THEN
    RAISE EXCEPTION 'a field edit with no status change was refused or lost';
  END IF;

  -- ---------------------------------------------------------
  -- 4. The identity columns are immutable. Each case moves the column to a
  --    real, valid, *different* value — a row that would satisfy every
  --    constraint in 001, so only the trigger can be what refuses it.
  -- ---------------------------------------------------------
  FOR v_edge IN
    SELECT * FROM (VALUES
      ('student_user_id'), ('teacher_user_id'), ('score_id'), ('studio_id'), ('created_at')
    ) AS t(column_name)
  LOOP
    v_rejected := false;
    BEGIN
      CASE v_edge.column_name
        WHEN 'student_user_id' THEN
          UPDATE public.assignments SET student_user_id = v_outsider WHERE id = v_row;
        WHEN 'teacher_user_id' THEN
          UPDATE public.assignments SET teacher_user_id = v_outsider WHERE id = v_row;
        WHEN 'score_id' THEN
          UPDATE public.assignments SET score_id = v_other_score WHERE id = v_row;
        WHEN 'studio_id' THEN
          UPDATE public.assignments SET studio_id = v_other_studio WHERE id = v_row;
        WHEN 'created_at' THEN
          UPDATE public.assignments SET created_at = now() - interval '1 year' WHERE id = v_row;
      END CASE;
    EXCEPTION WHEN check_violation THEN
      v_rejected := true;
    END;

    IF NOT v_rejected THEN
      RAISE EXCEPTION '% was mutable; 021 says the identity columns are not',
        v_edge.column_name;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------
  -- 5. A submitted analysis must belong to this assignment's student. The FK
  --    says the analysis exists; only this says whose it is, and the teacher
  --    read policy in 002 turns a wrong id into a cross-account read.
  -- ---------------------------------------------------------
  v_rejected := false;
  BEGIN
    UPDATE public.assignments
       SET status = 'submitted', submitted_analysis_id = v_outsider_take
     WHERE id = v_row;
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'another account''s analysis was accepted as this student''s submission';
  END IF;

  -- The student's own take is accepted on the same edge.
  UPDATE public.assignments
     SET status = 'submitted', submitted_analysis_id = v_take
   WHERE id = v_row;
  IF NOT EXISTS (
    SELECT 1 FROM public.assignments WHERE id = v_row AND submitted_analysis_id = v_take
  ) THEN
    RAISE EXCEPTION 'the student''s own take was refused as their submission';
  END IF;

  -- And at INSERT, which has no OLD row to compare against.
  v_rejected := false;
  BEGIN
    INSERT INTO public.assignments
      (studio_id, teacher_user_id, student_user_id, score_id, target_bpm,
       status, submitted_analysis_id)
    VALUES (v_studio, v_teacher, v_student, v_score, 92, 'submitted', v_outsider_take);
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'another account''s analysis was accepted at INSERT';
  END IF;

  RAISE NOTICE 'assignment transitions: graph, immutability and submission ownership all hold';
END
$$;

-- ---------------------------------------------------------
-- 6. No role but the service role may UPDATE assignments directly. Read from
--    the catalog rather than the migration text, because the grant that
--    matters is the one the database ended up with.
-- ---------------------------------------------------------
DO $$
DECLARE
  v_holder text;
BEGIN
  FOR v_holder IN
    SELECT grantee
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name = 'assignments'
       AND privilege_type = 'UPDATE'
       AND grantee IN ('authenticated', 'anon')
  LOOP
    RAISE EXCEPTION
      '% still holds UPDATE on assignments. Both parties are this one role, so '
      'no column grant separates what a student may write from what a teacher '
      'may write, and RLS is row-level. Writes go through the API.', v_holder;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'assignments'
       AND privilege_type = 'SELECT' AND grantee = 'authenticated'
  ) THEN
    RAISE EXCEPTION
      'authenticated lost SELECT on assignments; 021 revokes UPDATE only, and '
      'both parties read their own rows through the policies in 002';
  END IF;

  RAISE NOTICE 'assignment grants: SELECT kept, UPDATE revoked from authenticated and anon';
END
$$;
