-- =============================================================
-- Behavioural check for 030_rls_once_per_query
-- =============================================================
--
-- Run by `tools/check-migrations.py` after the set applies. Not a migration;
-- `migrations/*.sql` does not glob this directory.
--
-- Read from the catalog:
--   - no policy in `public` calls auth.uid() outside a scalar subquery —
--     including one added after 030 and written the old way, which is the
--     regression this exists for;
--   - the thirteen policies 030 altered are all still there, by name;
--   - each of the five foreign keys has an index that leads with its column.

DO $$
DECLARE
  v_bad text;
  v_count int;
  v_fk record;
BEGIN
  SELECT string_agg(format('%s.%s', tablename, policyname), ', ')
    INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (
       coalesce((length(qual) - length(replace(qual, 'auth.uid()', ''))) / length('auth.uid()'), 0)
         <> coalesce((length(qual) - length(replace(qual, 'SELECT auth.uid()', ''))) / length('SELECT auth.uid()'), 0)
       OR coalesce((length(with_check) - length(replace(with_check, 'auth.uid()', ''))) / length('auth.uid()'), 0)
         <> coalesce((length(with_check) - length(replace(with_check, 'SELECT auth.uid()', ''))) / length('SELECT auth.uid()'), 0)
     );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '030: policies call auth.uid() once per row; wrap it as (select auth.uid()): %', v_bad;
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND policyname IN (
       'owner full access on analyses', 'teacher reads assignment analyses',
       'student select own assignments', 'teacher full access on own assignments',
       'owner full access on scores', 'studio members can read shared scores',
       'studio members can read', 'studio owner full access',
       'user inserts own sync events', 'owner can delete own corrections',
       'owner can read own corrections', 'users select self',
       'owner inserts own verdict corrections');
  IF v_count <> 13 THEN
    RAISE EXCEPTION '030: expected the 13 altered policies, found %', v_count;
  END IF;

  FOR v_fk IN
    SELECT * FROM (VALUES
      ('assignments', 'score_id'),
      ('assignments', 'submitted_analysis_id'),
      ('pending_uploads', 'user_id'),
      ('studios', 'owner_user_id'),
      ('verdict_corrections', 'user_id')
    ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = format('public.%I', v_fk.tbl)::regclass
         AND a.attname = v_fk.col
    ) THEN
      RAISE EXCEPTION '030: public.%.% has no index leading with it', v_fk.tbl, v_fk.col;
    END IF;
  END LOOP;
END $$;
