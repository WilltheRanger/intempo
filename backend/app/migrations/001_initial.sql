-- =============================================================
-- 001_initial.sql — InTempo canonical DDL (Batch 1)
-- Verbatim copy of the schema block in intempo-combined.md §2
-- ("This is the canonical DDL"). Apply once via the Supabase
-- SQL editor or `supabase db push`.
-- =============================================================

-- =============================================================
-- Enums (declared once; reused as column types)
-- =============================================================

CREATE TYPE user_tier AS ENUM ('free', 'pro', 'teacher', 'student_via_teacher');
CREATE TYPE user_role AS ENUM ('student', 'teacher');
CREATE TYPE bpm_source AS ENUM ('manual', 'calibration_clip');
CREATE TYPE metronome_mode AS ENUM ('off', 'visual', 'haptic', 'audio_with_headphones');
CREATE TYPE analysis_status AS ENUM ('queued', 'processing', 'done', 'failed', 'failed_recoverable');
CREATE TYPE assignment_status AS ENUM ('assigned', 'in_progress', 'submitted', 'reviewed', 'archived');
CREATE TYPE sync_event_type AS ENUM ('analysis_queued', 'analysis_synced', 'ocr_queued', 'ocr_synced');

-- =============================================================
-- studios — defined first because users.studio_id references it
-- =============================================================

CREATE TABLE studios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,                 -- FK added after users table exists
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  seat_limit    int  NOT NULL DEFAULT 25 CHECK (seat_limit > 0 AND seat_limit <= 500),
  invite_code   text NOT NULL UNIQUE CHECK (length(invite_code) = 6),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX studios_invite_code_idx ON studios(invite_code);

-- =============================================================
-- users
-- =============================================================

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE CHECK (email ~* '^.+@.+\..+$'),
  tier        user_tier NOT NULL DEFAULT 'free',
  role        user_role NOT NULL DEFAULT 'student',
  studio_id   uuid REFERENCES studios(id) ON DELETE SET NULL,
  -- Personal-baseline rubato profile per piece, populated after 10 sessions/piece (see §7.5)
  baseline_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Role/tier sanity: a 'teacher' role implies tier 'teacher' and a non-null studio_id.
  CHECK (role <> 'teacher' OR (tier = 'teacher' AND studio_id IS NOT NULL))
);

-- Add the deferred FK from studios.owner_user_id now that users exists
ALTER TABLE studios
  ADD CONSTRAINT studios_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX users_studio_idx ON users(studio_id) WHERE studio_id IS NOT NULL;
CREATE INDEX users_tier_idx ON users(tier);

-- =============================================================
-- scores
-- =============================================================

CREATE TABLE scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title               text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  composer            text,
  source_image_url    text NOT NULL,
  score_json          jsonb NOT NULL,                  -- parsed note + rhythm data from Claude Vision
  shared_with_studio  uuid REFERENCES studios(id) ON DELETE SET NULL,
  ocr_confidence      float CHECK (ocr_confidence BETWEEN 0 AND 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scores_user_idx ON scores(user_id, created_at DESC);
CREATE INDEX scores_shared_studio_idx ON scores(shared_with_studio) WHERE shared_with_studio IS NOT NULL;

-- =============================================================
-- assignments — teacher-tier; ships in MVP schema, populated in V2
-- =============================================================

CREATE TABLE assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id             uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  teacher_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  student_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score_id              uuid NOT NULL REFERENCES scores(id) ON DELETE RESTRICT,
  target_bpm            float NOT NULL CHECK (target_bpm BETWEEN 20 AND 300),
  due_at                timestamptz,
  teacher_instructions  text,
  status                assignment_status NOT NULL DEFAULT 'assigned',
  submitted_analysis_id uuid,                          -- FK added after analyses exists
  teacher_review_notes  text,
  reviewed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Status timestamp consistency
  CHECK (status <> 'reviewed' OR reviewed_at IS NOT NULL),
  CHECK (status <> 'submitted' OR submitted_analysis_id IS NOT NULL)
);

CREATE INDEX assignments_student_status_idx ON assignments(student_user_id, status);
CREATE INDEX assignments_teacher_status_idx ON assignments(teacher_user_id, status);
CREATE INDEX assignments_studio_due_idx ON assignments(studio_id, due_at);

-- =============================================================
-- analyses
-- =============================================================

CREATE TABLE analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score_id        uuid NOT NULL REFERENCES scores(id) ON DELETE RESTRICT,
  audio_url       text NOT NULL,
  target_bpm      float NOT NULL CHECK (target_bpm BETWEEN 20 AND 300),
  bpm_source      bpm_source NOT NULL,
  metronome_mode  metronome_mode NOT NULL DEFAULT 'off',  -- §3 MVP feature; pipeline ignores in v1, telemetry uses it
  result_json     jsonb,                               -- per-note deltas, verdict, trend; null until status='done'
  status          analysis_status NOT NULL DEFAULT 'queued',
  failure_reason  text,                                -- populated when status='failed' or 'failed_recoverable'
  alignment_quality float CHECK (alignment_quality BETWEEN 0 AND 1),
  llm_fallback_used boolean NOT NULL DEFAULT false,    -- true if §7.5 hybrid pipeline triggered
  assignment_id   uuid REFERENCES assignments(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  CHECK (status <> 'done' OR (result_json IS NOT NULL AND finished_at IS NOT NULL))
);

CREATE INDEX analyses_user_created_idx ON analyses(user_id, created_at DESC);
CREATE INDEX analyses_score_idx ON analyses(score_id);
CREATE INDEX analyses_status_updated_idx ON analyses(status, updated_at);  -- supports the stuck-job sweeper from Batch 4
CREATE INDEX analyses_assignment_idx ON analyses(assignment_id) WHERE assignment_id IS NOT NULL;

-- Add the deferred FK now that analyses exists
ALTER TABLE assignments
  ADD CONSTRAINT assignments_submitted_analysis_fk
  FOREIGN KEY (submitted_analysis_id) REFERENCES analyses(id) ON DELETE SET NULL;

-- =============================================================
-- verdict_corrections — user feedback loop from §7.5
-- =============================================================

CREATE TABLE verdict_corrections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measure_number  int NOT NULL CHECK (measure_number > 0),
  app_verdict     text NOT NULL,                       -- what the app said
  user_verdict    text NOT NULL CHECK (user_verdict IN ('on_tempo', 'rushing', 'dragging', 'unsure')),
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verdict_corrections_analysis_idx ON verdict_corrections(analysis_id);

-- =============================================================
-- sync_events — audit trail for offline-sync correctness
-- =============================================================

CREATE TABLE sync_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_id          text NOT NULL,                     -- device's local SQLite row id
  event_type        sync_event_type NOT NULL,
  device_clock_at   timestamptz NOT NULL,
  server_clock_at   timestamptz NOT NULL DEFAULT now(),
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX sync_events_user_event_idx ON sync_events(user_id, event_type, server_clock_at DESC);
CREATE UNIQUE INDEX sync_events_user_local_idx ON sync_events(user_id, local_id, event_type);

-- =============================================================
-- updated_at triggers (apply to every table with updated_at)
-- =============================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_studios_updated_at     BEFORE UPDATE ON studios     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated_at       BEFORE UPDATE ON users       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_scores_updated_at      BEFORE UPDATE ON scores      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_assignments_updated_at BEFORE UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_analyses_updated_at    BEFORE UPDATE ON analyses    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
