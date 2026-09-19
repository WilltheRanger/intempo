-- =============================================================
-- Behavioural check for 023_analysis_assignment_integrity
-- =============================================================
--
-- Run by `tools/check-migrations.py` after the set applies. Not a migration;
-- `migrations/*.sql` does not glob this directory.
--
-- Same shape as `checks/022`: every rule 023's header states, exercised
-- against a real database. Every local is `v_`-prefixed because plpgsql treats
-- an ambiguous variable/column name as an error and most of these names are
-- columns on the tables under test.
--
-- Fixtures are left behind, like the gate's own database — a failure is worth
-- inspecting. `checks/022` has already inserted its own by the time this runs,
-- so every id here is distinct from that file's.

DO $$
DECLARE
  v_student  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_other    uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_teacher  uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  v_studio   uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_score    uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_score_b  uuid := 'cccccccc-0000-0000-0000-000000000002';
  v_open     uuid;
  v_archived uuid;
  v_others   uuid;
  v_wrong    uuid;
  v_take     uuid;
  v_rejected boolean;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_student, 'student023@check.invalid'),
    (v_other,   'other023@check.invalid'),
    (v_teacher, 'teacher023@check.invalid');
  INSERT INTO public.users (id, email) VALUES
    (v_student, 'student023@check.invalid'),
    (v_other,   'other023@check.invalid'),
    (v_teacher, 'teacher023@check.invalid');

  INSERT INTO public.studios (id, owner_user_id, name, invite_code)
    VALUES (v_studio, v_teacher, 'Check Studio 023', 'CHK023');

  INSERT INTO public.scores (id, user_id, title, source_image_url, score_json) VALUES
    (v_score,   v_student, 'Piece A', 'https://example.invalid/a.jpg', '{}'::jsonb),
    (v_score_b, v_student, 'Piece B', 'https://example.invalid/b.jpg', '{}'::jsonb);

  -- The student's own, open, on piece A.
  INSERT INTO public.assignments
    (studio_id, teacher_user_id, student_user_id, score_id, target_bpm, status)
    VALUES (v_studio, v_teacher, v_student, v_score, 92, 'assigned')
  RETURNING id INTO v_open;

  -- The student's own, on piece A, archived.
  INSERT INTO public.assignments
    (studio_id, teacher_user_id, student_user_id, score_id, target_bpm, status)
    VALUES (v_studio, v_teacher, v_student, v_score, 92, 'archived')
  RETURNING id INTO v_archived;

  -- Another account's, open.
  INSERT INTO public.assignments
    (studio_id, teacher_user_id, student_user_id, score_id, target_bpm, status)
    VALUES (v_studio, v_teacher, v_other, v_score, 92, 'assigned')
  RETURNING id INTO v_others;

  -- The student's own, open, but set on piece B.
  INSERT INTO public.assignments
    (studio_id, teacher_user_id, student_user_id, score_id, target_bpm, status)
    VALUES (v_studio, v_teacher, v_student, v_score_b, 92, 'assigned')
  RETURNING id INTO v_wrong;

  -- ---------------------------------------------------------
  -- 1. A take with no assignment is untouched. This is every take the app has
  --    ever submitted, so a trigger that broke it would break the product.
  -- ---------------------------------------------------------
  INSERT INTO public.analyses (user_id, score_id, audio_url, target_bpm, bpm_source)
    VALUES (v_student, v_score, 'https://example.invalid/plain.wav', 92, 'manual')
  RETURNING id INTO v_take;
  IF v_take IS NULL THEN
    RAISE EXCEPTION 'a take with no assignment_id was refused';
  END IF;

  -- ---------------------------------------------------------
  -- 2. The student's own open assignment, same piece, is accepted at INSERT.
  -- ---------------------------------------------------------
  INSERT INTO public.analyses
    (user_id, score_id, audio_url, target_bpm, bpm_source, assignment_id)
    VALUES (v_student, v_score, 'https://example.invalid/ok.wav', 92, 'manual', v_open)
  RETURNING id INTO v_take;
  IF NOT EXISTS (SELECT 1 FROM public.analyses WHERE id = v_take AND assignment_id = v_open) THEN
    RAISE EXCEPTION 'the student''s own open assignment was refused or lost';
  END IF;

  -- ---------------------------------------------------------
  -- 3. Another account's assignment is refused, at INSERT and at UPDATE.
  --    This is the one the teacher read policy in 002 would otherwise expose.
  -- ---------------------------------------------------------
  v_rejected := false;
  BEGIN
    INSERT INTO public.analyses
      (user_id, score_id, audio_url, target_bpm, bpm_source, assignment_id)
      VALUES (v_student, v_score, 'https://example.invalid/steal.wav', 92, 'manual', v_others);
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'a take was attached to another account''s assignment at INSERT';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.analyses SET assignment_id = v_others WHERE id = v_take;
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'a take was moved onto another account''s assignment at UPDATE';
  END IF;

  -- ---------------------------------------------------------
  -- 4. An assignment for a different piece is refused.
  -- ---------------------------------------------------------
  v_rejected := false;
  BEGIN
    INSERT INTO public.analyses
      (user_id, score_id, audio_url, target_bpm, bpm_source, assignment_id)
      VALUES (v_student, v_score, 'https://example.invalid/mismatch.wav', 92, 'manual', v_wrong);
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'a take of one piece was attached to an assignment set on another';
  END IF;

  -- ---------------------------------------------------------
  -- 5. An archived assignment is refused — 022 made archived terminal, and a
  --    take attached to one has nowhere to be reported.
  -- ---------------------------------------------------------
  v_rejected := false;
  BEGIN
    INSERT INTO public.analyses
      (user_id, score_id, audio_url, target_bpm, bpm_source, assignment_id)
      VALUES (v_student, v_score, 'https://example.invalid/archived.wav', 92, 'manual', v_archived);
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'a take was attached to an archived assignment';
  END IF;

  -- ---------------------------------------------------------
  -- 6. An ordinary status write on an already-linked take is untouched. This
  --    is the worker's path — it writes `status` and `result_json` on a row
  --    whose assignment is already set, and re-validating there would fail a
  --    verdict because a teacher archived the assignment mid-analysis.
  -- ---------------------------------------------------------
  UPDATE public.assignments SET status = 'archived' WHERE id = v_open;
  UPDATE public.analyses SET status = 'processing' WHERE id = v_take;
  IF NOT EXISTS (
    SELECT 1 FROM public.analyses WHERE id = v_take AND status = 'processing'
  ) THEN
    RAISE EXCEPTION
      'a status write on an already-linked take was refused; the worker cannot '
      'finish a take whose assignment was archived while it ran';
  END IF;

  RAISE NOTICE 'analysis/assignment integrity: ownership, piece, archived and the worker path all hold';
END
$$;
