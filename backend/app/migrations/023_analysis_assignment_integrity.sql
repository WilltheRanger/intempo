-- =============================================================
-- 023_analysis_assignment_integrity — the other end of the join 022 protected
-- =============================================================
--
-- **022 guarded `assignments.submitted_analysis_id` and left
-- `analyses.assignment_id` open.** Found while writing the endpoint that first
-- sets it, which is the only reason it was found at all: 022 reasoned carefully
-- about a take being claimed by the wrong assignment and not at all about an
-- assignment being claimed by the wrong take.
--
-- `001` gives `analyses.assignment_id` a foreign key to `assignments`, so the
-- assignment has to exist. A foreign key cannot say **whose** it is, or **what
-- piece** it is for, and both matter here:
--
--   * `002`'s `"teacher reads assignment analyses"` grants a teacher SELECT on
--     every analysis whose `assignment_id` is one of theirs. A take pointed at
--     a stranger's assignment is therefore readable by that stranger. It is
--     the take's own owner who loses by it rather than a third party, so this
--     is not the hole 022 closed — but a row a teacher did not ask for
--     appearing in their studio's view is wrong in its own right, and it is
--     one mistyped id away.
--   * The delta view groups a student's takes by `comparison_key()`, which
--     folds in `score_id`. An assignment set on one piece holding takes of
--     another produces a comparison of two different pieces and calls it
--     progress.
--
-- The endpoint validates all of this before inserting. This is the floor under
-- it, for the reason 022's header gives about its own trigger: the router is
-- where the rule belongs and also where a wrong `.eq()` lives, and a trigger
-- is the only control that applies to the service role, which is the only
-- writer.
--
-- **`archived` is refused too.** A take recorded against an assignment the
-- teacher has put away has nowhere to be reported, and 022 already made
-- `archived` terminal on the other side; allowing a take to attach to one
-- would be the same state reachable by a different door.
--
-- The `a_student IS NULL` branch looks unreachable behind a foreign key and is
-- load-bearing: if the row is somehow missing, `a_student <> NEW.user_id`
-- evaluates to NULL rather than true, so every check below it would pass
-- quietly. NULL is the one comparison result that must not be read as consent.
--
-- Held by `migrations/checks/023_analysis_assignment_integrity.sql`, which
-- exercises each refusal and the accepted case against a real database.
--
-- Idempotent: `CREATE OR REPLACE` for the function, `DROP ... IF EXISTS`
-- before the trigger. `tools/check-migrations.py` applies it twice.

CREATE OR REPLACE FUNCTION public.analyses_enforce_assignment()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
DECLARE
  a_student uuid;
  a_score   uuid;
  a_status  public.assignment_status;
BEGIN
  IF NEW.assignment_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only when the link is being made or changed. A take whose assignment is
  -- already set and unchanged must not re-validate on every status write the
  -- worker makes, or an assignment archived mid-analysis would fail the
  -- verdict rather than the attachment.
  IF TG_OP = 'UPDATE' AND NEW.assignment_id IS NOT DISTINCT FROM OLD.assignment_id THEN
    RETURN NEW;
  END IF;

  SELECT s.student_user_id, s.score_id, s.status
    INTO a_student, a_score, a_status
    FROM public.assignments s
   WHERE s.id = NEW.assignment_id;

  IF a_student IS NULL THEN
    RAISE EXCEPTION
      'analysis %: assignment % has no row; refusing rather than comparing '
      'against NULL, which would pass every check below',
      NEW.id, NEW.assignment_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF a_student <> NEW.user_id THEN
    RAISE EXCEPTION
      'analysis %: assignment % is %''s, not this take''s owner %; the teacher '
      'read policy in 002 would put this take in another studio''s view',
      NEW.id, NEW.assignment_id, a_student, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF a_score <> NEW.score_id THEN
    RAISE EXCEPTION
      'analysis %: assignment % is set on piece %, and this take is of %; '
      'comparing them would call two different pieces progress',
      NEW.id, NEW.assignment_id, a_score, NEW.score_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF a_status = 'archived'::public.assignment_status THEN
    RAISE EXCEPTION
      'analysis %: assignment % is archived, which 022 made terminal; a take '
      'attached to it has nowhere to be reported',
      NEW.id, NEW.assignment_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.analyses_enforce_assignment() IS
  'A take may only name an assignment that is its own owner''s, is set on the same piece, and is not archived. The foreign key in 001 says the assignment exists; none of these three follow from that. Validated in the router too, where the actor is known — this is the floor under it, and the only control that applies to the service role. See migration 023.';

DROP TRIGGER IF EXISTS trg_analyses_assignment ON public.analyses;
CREATE TRIGGER trg_analyses_assignment
  BEFORE INSERT OR UPDATE ON public.analyses
  FOR EACH ROW EXECUTE FUNCTION public.analyses_enforce_assignment();
