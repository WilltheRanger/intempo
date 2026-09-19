-- =============================================================
-- 021_assignment_transitions — close the assignment row before anything writes one
-- =============================================================
--
-- **Nothing has ever created an assignment.** `001` built the table, `002` gave
-- it policies, and `models/assignment.py` says in its own docstring that no MVP
-- endpoint reads or writes one. The teacher-tier router is the next thing to
-- land, so this is the last migration that can go in *before* there are rows to
-- get wrong.
--
-- Two things are wrong today, and both are only wrong once rows exist.
--
-- ## 1. A student could write the teacher's half of their own row
--
-- `002` gives students this:
--
--     CREATE POLICY "student update status on own assignments"
--       ON assignments FOR UPDATE
--       USING (auth.uid() = student_user_id)
--       WITH CHECK (auth.uid() = student_user_id);
--
-- The name says `status`. **Row-level security is row-level**; it has no
-- opinion about columns. A student holding the anon key — which is inlined
-- into the published bundle by design, the situation
-- `app/tests/test_rls_invariants.py` is written from — passes that policy on
-- their own row and may then set `teacher_review_notes`, `target_bpm`,
-- `due_at`, or `status = 'reviewed'`. The table's
-- `CHECK (status <> 'reviewed' OR reviewed_at IS NOT NULL)` does not stop it:
-- set `reviewed_at` in the same statement and the check passes.
--
-- **Column grants cannot fix this, and that is the part worth writing down.**
-- Teacher and student are both the Postgres role `authenticated` — the
-- distinction between them lives in `auth.uid()`, inside the policy predicate,
-- not in the role. `GRANT UPDATE (status, submitted_analysis_id)` would
-- therefore take `teacher_review_notes` away from the teacher too. There is no
-- per-column split of one role into two actors.
--
-- So the grant goes instead. The app's supabase-js client is **auth-only** —
-- `mobile/src/data/auth/session.ts` calls `supabase.auth.*` and nothing in
-- `mobile/src/` calls `.from()` or `.table()` on a data table. Every read and
-- write of application data already goes through this backend on the
-- service-role client. Revoking direct UPDATE costs no existing caller, and the
-- SELECT policies both parties actually rely on are untouched.
--
-- The student UPDATE policy is dropped with the grant rather than left inert.
-- An enabled policy that cannot be exercised is the failure `020` describes
-- about `pending_uploads` in reverse: something that reads as a working control
-- in every audit that greps for it.
--
-- ## 2. Nothing enforces the transition graph, on the path that actually runs
--
-- `002` says a trigger "added in Batch 12 when the teacher tier ships" will
-- enforce the graph. This is that trigger, and it is deliberately **not** the
-- trigger that comment implies.
--
-- The obvious shape — read `auth.uid()`, allow students one set of edges and
-- teachers another — **does nothing at all here.** The service role bypasses
-- RLS and `auth.uid()` is NULL on a service-role connection (the stub in
-- `tools/supabase_stubs.sql` returns NULL for precisely this reason: it is what
-- a policy evaluated by nobody should see). Since the API is the only writer,
-- an actor-aware trigger would be a control that is invisible in the one place
-- it needs to hold.
--
-- What a trigger *can* enforce is what is true of a valid transition whoever
-- makes it. A trigger applies to the service role; a policy does not. That
-- makes this the only control in the schema that reaches the API's own writes,
-- so what it holds is the invariants a buggy handler would break:
--
--   * the status graph, including `submitted -> in_progress` and
--     `reviewed -> in_progress` — the retry loop is the product, so sending a
--     passage back for another take is an ordinary edge, not an exception;
--   * `archived` is terminal;
--   * the identity columns are immutable — moving `student_user_id` would hand
--     one student's takes to another, and it is one wrong `.eq()` away;
--   * `submitted_analysis_id` must name an analysis **belonging to this
--     assignment's student**. The FK added at `001:141` guarantees the analysis
--     exists. It cannot say whose it is, and the teacher read policy in `002`
--     grants the teacher every analysis joined to their assignment — so a
--     mis-set id is a cross-account read, not a broken link.
--
-- Who may make which edge stays where the actor is actually known: the router.
-- This is the floor under it, not a substitute for it.
--
-- ## What holds this
--
-- `migrations/checks/021_assignment_transitions.sql` exercises every edge and
-- every invariant above against a real database, run by
-- `tools/check-migrations.py` after the set applies. `readiness.py` cannot see
-- any of it — it probes columns and tables over REST, and a trigger is neither
-- — so a deployment missing this migration looks exactly like one that has it.
-- The migrations gate is the only thing that knows.
--
-- Idempotent by construction, and applied twice by the gate: `CREATE OR
-- REPLACE` for the function, `DROP ... IF EXISTS` before the trigger and the
-- policy, and REVOKE of an absent privilege is a no-op.

-- -------------------------------------------------------------
-- 1. No direct UPDATE on assignments, for anyone but the service role
-- -------------------------------------------------------------

DROP POLICY IF EXISTS "student update status on own assignments" ON public.assignments;

REVOKE UPDATE ON public.assignments FROM authenticated;
REVOKE UPDATE ON public.assignments FROM anon;

COMMENT ON TABLE public.assignments IS
  'Teacher-tier assignments. `authenticated` and `anon` hold SELECT only: both parties are the same Postgres role, so a column-level GRANT cannot separate what a student may write from what a teacher may write, and RLS is row-level and cannot either. All writes go through the backend on the service-role client, and public.assignments_enforce_transition() is the floor under those writes — it applies to the service role, which no policy does. Do not re-grant UPDATE here to make a direct-from-client write work; add the endpoint instead. See migration 021.';

-- -------------------------------------------------------------
-- 2. The transition graph and the row's invariants
-- -------------------------------------------------------------

-- `search_path = ''` for the reason 020 sets it on `set_updated_at()`: a
-- function whose path resolves at call time can be pointed at a schema the
-- caller controls. That makes every reference below necessarily qualified —
-- `public.analyses`, and the enum labels cast to `public.assignment_status` so
-- a label that is not in the enum fails when this file is applied rather than
-- silently never matching.
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
      OR (OLD.status = 'reviewed'::public.assignment_status
            AND NEW.status IN ('in_progress'::public.assignment_status,
                               'archived'::public.assignment_status))
    ) THEN
      RAISE EXCEPTION
        'assignment %: % -> % is not a transition; archived is terminal, and '
        'a passage goes back for another take through in_progress',
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
  'The status graph, the immutable identity columns, and the rule that a submitted analysis belongs to the assignment''s own student. Actor-agnostic on purpose: auth.uid() is NULL on the service-role connection that performs every write, so a trigger that read it would hold nowhere that matters. Who may make which edge belongs in the router, where the actor is known. See migration 021.';

DROP TRIGGER IF EXISTS trg_assignments_transition ON public.assignments;
CREATE TRIGGER trg_assignments_transition
  BEFORE INSERT OR UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.assignments_enforce_transition();
