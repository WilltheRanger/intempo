-- =============================================================
-- Behavioural check for 029_saxophone
-- =============================================================
--
-- Run by `tools/check-migrations.py` after the set applies. Not a migration;
-- `migrations/*.sql` does not glob this directory.
--
-- Read from the catalog: each table holds exactly one CHECK on `instrument`
-- (a drop that missed its name would leave the old one beside the new, and
-- the narrower one would still refuse a saxophone), and that one names both
-- saxophones.

DO $$
DECLARE
  v_table text;
  v_count int;
  v_def text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['analyses', 'users'] LOOP
    SELECT count(*), max(pg_get_constraintdef(c.oid))
      INTO v_count, v_def
      FROM pg_constraint c
     WHERE c.conrelid = format('public.%I', v_table)::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%instrument%';
    IF v_count <> 1 THEN
      RAISE EXCEPTION '029: public.% has % CHECK constraints on instrument; expected exactly one', v_table, v_count;
    END IF;
    IF v_def NOT LIKE '%alto_sax%' OR v_def NOT LIKE '%tenor_sax%' THEN
      RAISE EXCEPTION '029: public.%.instrument does not allow both saxophones: %', v_table, v_def;
    END IF;
  END LOOP;
END
$$;
