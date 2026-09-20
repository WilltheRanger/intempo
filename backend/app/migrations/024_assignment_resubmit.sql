-- =============================================================
-- 024_assignment_resubmit — `reviewed -> submitted`, because the loop repeats
-- =============================================================
--
-- **022's graph has no way out of `reviewed`, and that makes the weekly loop a
-- one-shot.** Found while writing the endpoints, which is the only way it
-- could have been found: the graph reads sensibly until you ask which endpoint
-- moves a reviewed assignment anywhere.
--
-- 022 allowed `reviewed -> in_progress` and `reviewed -> archived`, and refused
-- `reviewed -> submitted` on the reasoning that "a passage goes back for
-- another take through in_progress". That is a claim about a screen, not about
-- the data — and nothing sets `in_progress`. The six endpoints are create,
-- list, get, submit, review and takes; none of them is "start another
-- attempt". So a student who receives feedback and records a better take had
-- nowhere to put it, and the retry loop this product *is* would end at the
-- first review.
--
-- The honest reading: `submitted` means a take is waiting on the teacher and
-- `reviewed` means the teacher has answered. A student answering back with a
-- new take moves it to waiting again. `reviewed -> submitted` is that move,
-- and excluding it was over-constraint on my part rather than a rule.
--
-- `submitted -> submitted` needs nothing: 022 only inspects the edge when the
-- status actually changes, so replacing the take under an unreviewed
-- submission was always allowed and stays that way.
--
-- **`assigned -> reviewed` and `in_progress -> reviewed` stay refused**, which
-- is the rule this does not weaken: a review is a review *of* a submission,
-- and reaching it without one would leave `submitted_analysis_id` null under a
-- `reviewed` row — which the table's own CHECK does not forbid and which the
-- teacher's screen could not render. `archived` stays terminal.
--
-- `CREATE OR REPLACE` on the one function 022 installed; the trigger already
-- points at it and is left alone. `checks/022` moved the pair from its
-- rejected list to its accepted list in the same commit, so the two files
-- cannot drift.
--
-- Idempotent by construction: re-running replaces a function definition.
--
-- **And the gate's idempotency re-run cannot undo this**, which is worth
-- saying because it looks like it could: `check-migrations.py` applies every
-- migration in order, then re-applies each one from 013 on, and 022 installs
-- an *older* definition of the same function. The re-run is in the same
-- ascending order as the first pass, so 024 is the last writer both times.
-- Verified against the gate's database rather than reasoned about — the live
-- definition after a full run carries this file's comment.

CREATE OR REPLACE FUNCTION public.assignments_enforce_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
DECLARE
  submitted_by uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.studio_id       IS DISTINCT FROM OLD.studio_id
    OR NEW.teacher_user_id IS DISTINCT FROM OLD.teacher_user_id
    OR NEW.student_user_id IS DISTINCT FROM OLD.student_user_id
    OR NEW.score_id        IS DISTINCT FROM OLD.score_id
    OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION
        'assignment %: studio, teacher, student, score and created_at are immutable; '
        'archive this assignment and create another rather than repointing it',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'assigned'::public.assignment_status
            AND NEW.status IN ('in_progress'::public.assignment_status,
                               'submitted'::public.assignment_status,
                               'archived'::public.assignment_status))
      OR (OLD.status = 'in_progress'::public.assignment_status
            AND NEW.status IN ('submitted'::public.assignment_status,
                               'archived'::public.assignment_status))
      OR (OLD.status = 'submitted'::public.assignment_status
            AND NEW.status IN ('reviewed'::public.assignment_status,
                               'in_progress'::public.assignment_status,
                               'archived'::public.assignment_status))
      -- 024: a student answering feedback with a better take. The edge 022
      -- refused, which left `reviewed` with no way forward and the loop
      -- unable to repeat.
      OR (OLD.status = 'reviewed'::public.assignment_status
            AND NEW.status IN ('submitted'::public.assignment_status,
                               'in_progress'::public.assignment_status,
                               'archived'::public.assignment_status))
    ) THEN
      RAISE EXCEPTION
        'assignment %: % -> % is not a transition; archived is terminal, and a '
        'review is a review of a submission',
        OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.submitted_analysis_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.submitted_analysis_id IS DISTINCT FROM OLD.submitted_analysis_id) THEN
    SELECT a.user_id INTO submitted_by
      FROM public.analyses a
     WHERE a.id = NEW.submitted_analysis_id;

    IF submitted_by IS DISTINCT FROM NEW.student_user_id THEN
      RAISE EXCEPTION
        'assignment %: submitted analysis % belongs to %, not to this '
        'assignment''s student %; the teacher read policy in 002 would make '
        'this a cross-account read',
        NEW.id, NEW.submitted_analysis_id, submitted_by, NEW.student_user_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.assignments_enforce_transition() IS
  'The status graph, the immutable identity columns, and the rule that a submitted analysis belongs to the assignment''s own student. Actor-agnostic on purpose: auth.uid() is NULL on the service-role connection that performs every write, so a trigger that read it would hold nowhere that matters. Who may make which edge belongs in the router, where the actor is known. Installed by 022; the graph gained reviewed -> submitted in 024, without which a reviewed assignment could never receive another take. See migrations 022 and 024.';
