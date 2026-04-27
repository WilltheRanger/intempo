# InTempo — Combined Project + Build Plan

**Owner:** [TBD]
**Status:** Pre-build / planning
**Last updated:** 2026-04-25 (rev 14)
**Doc purpose:** This is the merged reference for InTempo — the *what* and *why* (Part I, Project Plan) and the *how to build it* (Part II, Build Plan), in a single document. Read Part I before writing code; consult Part II when starting any batch.

### Combined Changelog

- **rev 14 (2026-04-25):** Splash pendulum refined to a six-element composition. Upgraded from a thin line + dot to: a substantial 2px suspension beam at top, a filled triangular hanger, a hollow pivot ring (warm-white fill + black stroke — looks like a real jewel-bearing pivot), a 2px rod with a small black collar where it meets the weight, a 13px-radius amber weight with a subtle accent-soft highlight ellipse, a dotted swing-path arc with three tick marks suggesting beat positions, and two faint amber ghost-trail circles at the swing extremes that fade in/out synced to the swing direction (long-exposure motion feel). SVG enlarged to 140×180. Animation tuned to ±17° rotation. Full SVG markup + CSS spec updated in §3.5. Design preview HTML updated to v0.7.
- **rev 13 (2026-04-25):** Splash pendulum upgraded — bigger (120×152), proper hanging pendulum geometry (anchor bar, pivot dot, vertical rod, amber weight at end, dotted swing-path arc), and animated. Full SVG markup + CSS keyframes + reduced-motion fallback now spec'd in §3.5. Animation: ±16° rotation, 1.1s per half-swing (≈55 BPM full cycle), `cubic-bezier(0.42, 0, 0.58, 1)` easing for sine-like motion. Design preview HTML updated to v0.6.
- **rev 12 (2026-04-25):** Splash screen redesigned in §3.5 per-screen notes. Default behavior is instant load — no splash renders at all if the cold-start completes in under 300ms (matching Linear/Things/Cron). When the splash does render, it's a quiet branded composition: wordmark, pendulum-arc visualization (thin rod, amber weight, dotted swing-path), contextual line ("Picking up [last piece]"), thin amber progress line growing along the bottom. No spinner or bouncing dots. Design preview HTML updated to v0.5.
- **rev 11 (2026-04-25):** Tightened the §3.5 "Language: musician, not engineer" subsection. Verdict labels are now a five-state vocabulary (On tempo / Slight rush / Rushing / Slight drag / Dragging) shown as words, not numbers. Numbers (BPM offsets, percentages, milliseconds) are banned from production UI except for the recording timer and the target BPM on the recording screen. Tap-to-reveal pattern documented for power users who want the underlying number. Design preview HTML updated to v0.3 — per-measure detail rows now show "On tempo / Slight rush / Rushing" instead of "+1/+4/+7 BPM" values, and the headline subtitle reads "Rushing in measures 8–12. Otherwise on tempo."
- **rev 10 (2026-04-25):** New §3.5 Design System & Visual Direction — full design spec for vibe coding. Linear-leaning aesthetic with warmth, complete color tokens (with hex values), typography scale (Geist Sans, sizes 11–44, weights 400/500 only), 8pt spacing grid, four-value border-radius scale, motion specs (200ms default, 400ms spring on verdict reveal, 40ms stagger), component primitives (button/card/eyebrow), the 14-item don't-do list, per-screen design notes for the 6 critical screens, musician-not-engineer language rules (BPM not %), art-director discipline for the human, app icon strategy (Midjourney/Fiverr — not vibe-coded), App Store Preview video spec, and DoD additions for every UI batch. Companion HTML file `docs/intempo-design-preview.html` with three rendered reference screens added to the Batch 0 commit.
- **rev 9 (2026-04-25):** Optional metronome feature, phased v1/v2/v3. MVP (v1) ships visual metronome (web + mobile) and haptic (mobile only) — no audio click — to avoid mic bleed corrupting the analysis. V2 adds audio click gated by detected headphones via OS audio-route API. V3 adds click-aware onset detection for audio metronome without headphones. New §4 "Critical recording-environment constraint: no audio bleed in MVP" subsection. New `metronome_mode` enum + column on `analyses` for telemetry (pipeline ignores it in v1). Batch 7 gets `MetronomeToggle.tsx`, `VisualMetronome.tsx`, and `useVisualMetronome` hook with `audioContext.currentTime`-based scheduling. Batch 9 adds native haptic via `expo-haptics` with drift-corrected timer (explicitly not `setInterval`).
- **rev 8 (2026-04-25):** Two upgrades. (1) New "Accessibility & inclusive design (MVP requirements, not V2)" subsection in §3 — color-blind safety with palette + icon + label requirements, screen-reader labels for verdicts and charts, touch-target sizing, font-scaling, reduced-motion, hearing-impaired considerations, WCAG 2.1 AA contrast. Marked as DoD criteria for every UI batch. (2) Upgraded the Postgres schema in §2 from prose-ish to canonical DDL — explicit `CREATE TABLE`, enums, NOT NULL/CHECK constraints, foreign-key `ON DELETE` policies, indexes (including the `analyses(status, updated_at)` index for Batch 4's stuck-job sweeper), updated-at trigger function, plus a `verdict_corrections` table for §7.5's feedback loop and a tighter `sync_events` schema. RLS policy outline included.
- **rev 7 (2026-04-25):** Wired the master spec + three log files into Batch 0 — repo tree now lists `intempo-combined.md`, `EDIT_LOG.md`, `DECISIONS.md`, `TUNING_LOG.md` at repo root with starter headers; new step 2 commits all four before any code is written and tags the commit `spec-v1`; new step 9 writes the first EDIT_LOG entry for the scaffold itself; DoD updated to require `batch-0-done` tag pushed.
- **rev 6 (2026-04-25):** Added Operating-principle #8 (record every edit) plus a full "Build-time activity logging — what to record, where, and how" subsection in Part II. Specifies `EDIT_LOG.md` format, what counts as a meaningful change, the four-log architecture (EDIT_LOG / DECISIONS / TUNING_LOG / git history), commit & tag discipline, and the recovery procedure when something breaks. Also added Batch 3 Tuning Appendix in rev 5b — a field guide for audio-pipeline threshold tuning with dashboard scaffold, six-clip corpus spec, prompt template, strict tuning order, empirical band setting, and TUNING_LOG.md format.
- **rev 5 (2026-04-25):** Phased async-worker strategy. Project plan §2 starts with FastAPI `BackgroundTasks` for the MVP and migrates to Celery + Redis on documented latency/throughput triggers. §11 adds a "BackgroundTasks vs Celery" tech-stack subsection. Build plan Batch 0 drops Redis from the day-one Docker compose; Batch 4 uses BackgroundTasks with a "Migration to Celery" subsection at the end covering triggers, file diffs, and ops work.
- **rev 4 (2026-04-25):** Folded §7.5 Accuracy Mitigations & Failure Modes into Part I — concrete fixes for legato/slur detection, sub-5% rubato confidence bands, DTW misalignment guards, room acoustics handling, phrase-first UI, plus hybrid LLM-fallback pipeline and user feedback loop.
- **rev 3 (2026-04-25):** Merged project plan + build plan into one document. Part I retains original section numbering (§1–§13); Part II covers operating principles, session structure, and Batches 0–14+. Cross-references like "see §2 of project plan" continue to work.
- **rev 2 (2026-04-25):** Build plan: added session-structure analysis (one-session vs multi-session vs human-in-loop) and Cowork+Dispatch decomposition for hard batches. Added critical-path advice for Batches 3, 4, 7. Project plan: added §2.1 Offline & Connectivity Strategy, expanded calibration-clip edge cases in §4, made iOS-first explicit in §9 and §11, expanded teacher tier workflow + DB fields, updated DTW references to lead with librosa docs.
- **rev 1 (2026-04-25):** Initial draft of project plan and build plan as separate documents.

### How this document is structured

**Part I — Project Plan.** What InTempo is, who it's for, the technical architecture, the audio + OCR + alignment pipeline, monetization, GTM, timeline, risks, and open questions. Section numbering §1–§13.

**Part II — Build Plan.** Operating principles for the build, how each batch maps to Cowork/Dispatch sessions, then 14 batches (Batch 0 Foundations → Batch 13 Launch + Batch 14+ post-launch) with everything needed: scope, deliverables, acceptance criteria, code stubs, gotchas. Critical-path advice for the hardest batches (3, 4, 7).

When Part II references project-plan sections (e.g. "see §2 architecture"), those references point at Part I — they continue to work because Part I keeps the original numbering.

---

# Part I — Project Plan


---

## 1. Executive Summary

### What it does
A musician takes a photo of their sheet music, records themselves playing, and InTempo tells them — measure by measure — whether they were *rushing*, *dragging*, or *on tempo* relative to the score. Output is a color-coded annotated score and a single per-piece "tempo verdict" with a rolling-average trend chart.

The app is **not** a metronome. The user supplies the tempo target (either by tapping it in or playing a 2-second calibration clip in their own chosen tempo), and InTempo measures their *consistency relative to that target*, not absolute "right tempo."

### Problem it solves
Every serious instrumentalist's teacher says "you're rushing." Self-recording is the standard fix, but listening back to a 4-minute recording with a metronome ticking is tedious and most students don't have the analytical ear to catch where they sped up. InTempo automates the diagnosis: 30 seconds after you stop playing, you see exactly which measures drifted and by how many BPM.

This is essentially a **structured-feedback loop tool** for a problem that currently requires either (a) a teacher present, or (b) significant musical-analytical effort the student doesn't have.

### Target users (in order of priority)

1. **Pre-college string students (ages 12–18)** preparing audition repertoire. They have private teachers, daily practice obligations, and explicit tempo expectations on excerpts. **Highest willingness to pay; clearest pain point.**
2. **College and conservatory string students.** Higher technical skill; same pain point. Smaller absolute population but higher ACV via teacher-tier institutional sales.
3. **Adult amateur orchestral musicians.** Lower urgency but loyal user base.
4. **Private music teachers.** Both as a *user* (assigning practice with InTempo, reviewing student-submitted recordings) and as the B2B distribution channel.

Initial instrument focus: **double bass** (founder's instrument, well-known to product owner) and other orchestral strings (violin, viola, cello). Architecture must allow expansion to wind/brass/keyboard later — the audio pipeline shouldn't be string-specific even if MVP tuning is.

### Monetization model — freemium + teacher tier

| Tier | Price | Audience | Limits |
|---|---|---|---|
| **Free** | $0 | Trial users, casual practicers | 3 analyses/month, no save/history, web only |
| **Pro** | $7.99/mo or $59/yr | Serious students | Unlimited analyses, saved history, comparison view, advanced metrics |
| **Teacher** | $19.99/mo per studio (up to 25 students) | Private teachers, school programs | Pro features for teacher + assigned student accounts, dashboard view, assignment builder |

Pro tier covers the majority of revenue; Teacher tier is the high-LTV low-CAC channel via teacher-driven adoption. See §8 for full pricing math.

### Why this is buildable now
Three things changed recently that make this practical:
- **Vision-language models** (Claude, GPT-4V) can OCR handwritten and printed music with usable accuracy without building a custom OMR engine.
- **Mobile audio processing has matured.** React Native's audio APIs + on-device ML kits handle the recording layer cleanly.
- **librosa + onset detection** are stable and well-documented; the score-alignment problem is a well-studied DTW use case.

A solo developer or small team can ship a usable MVP in 8–12 weeks.

---

## 2. Technical Architecture

### High-level data flow

```
[User opens app]
   ↓
[Take photo of sheet music]
   ↓
[Upload to backend → Claude Vision API → JSON score representation]
   ↓
[Display parsed score; user confirms / edits]
   ↓
[Optional: 2-sec calibration clip → BPM target lock]
   ↓
[User records themselves playing the piece]
   ↓
[Audio uploaded to backend (or processed on-device for short clips)]
   ↓
[librosa onset detection → note-onset timestamps]
   ↓
[DTW alignment of detected onsets to score-derived expected onsets]
   ↓
[Per-note timing deltas → tolerance band classification]
   ↓
[Rolling-average smoothing + trend detection]
   ↓
[Annotated score + verdict returned to client]
```

### Layer breakdown

#### Frontend — React Native (iOS + Android, single codebase)

- **Framework:** React Native 0.74+
- **Navigation:** React Navigation v7
- **State:** Zustand (lightweight, no boilerplate)
- **Audio recording:** `react-native-audio-recorder-player` for record/playback; `react-native-audio-toolkit` as a fallback
- **Camera:** `react-native-vision-camera` for sheet music capture (better autofocus than expo-camera for text)
- **Score rendering:** Initially a server-rendered annotated PNG (simpler). V2: client-side rendering via `verovio` (WebAssembly-based MEI/MusicXML renderer)
- **Charts:** `victory-native` for the timing-trend visualization
- **Auth + sync:** Supabase Auth + Realtime
- **Build/deploy:** EAS Build (Expo's managed build pipeline) — even though we're using bare React Native, EAS handles iOS provisioning headaches

#### Backend — Python + FastAPI

- **Framework:** FastAPI (async, type-hinted, fast)
- **Auth:** Supabase JWT verification middleware
- **Storage:**
  - PostgreSQL (via Supabase) for user data, score metadata, analysis results
  - S3 (or Supabase Storage) for raw audio + score images
- **Audio processing:** librosa, numpy, scipy
- **Score parsing call:** anthropic SDK (Claude Vision)
- **Background jobs:** Phased — start with **FastAPI `BackgroundTasks`** for the MVP (in-process, zero ops overhead), migrate to **Celery + Redis** once we have data on real job latency, throughput, and crash patterns. See §11 for the trigger criteria and migration plan. Don't block the API response either way.
- **API style:** REST. Endpoints below.

#### Audio analysis pipeline (Python)

| Step | Library | What it does |
|---|---|---|
| Load audio | `librosa.load(sr=22050)` | Mono, 22.05 kHz (sufficient for onset detection; halves CPU cost vs 44.1k) |
| Pre-emphasis filter | `librosa.effects.preemphasis` | Boost high frequencies for clearer onsets, especially helpful in low-register double bass |
| Onset detection | `librosa.onset.onset_detect` with `pre_max=20, post_max=20, delta=0.07` | Returns timestamp (in sec) of each detected note onset |
| Onset envelope | `librosa.onset.onset_strength` | Used to filter weak onsets (vibrato wobble vs real note attack) |
| Tempo estimate | `librosa.beat.beat_track` | Sanity-check the user's calibration tempo |
| Slur detection (V2) | Custom: spectral centroid stability + onset gap | If pitch changes but onset envelope shows no attack peak, treat as slurred |
| DTW alignment | `librosa.sequence.dtw` | Map detected onsets to expected onsets from the score |
| Per-note delta | numpy | `actual_onset - expected_onset_at_target_BPM` → +ve = late (dragging) / -ve = early (rushing) |
| Tolerance band classification | numpy | Classify as `on`, `rushing`, `dragging`, or `severe` based on % deviation |
| Rolling trend | pandas `.rolling(window=8).mean()` | Smoothed trend line for the verdict chart |

#### Sheet music OCR — Claude Vision API

- Direct API call to `claude-opus-4-7` (or `claude-sonnet-4-6` for cost) with the sheet music image and a structured prompt requesting note + rhythm JSON.
- Response is parsed into our internal score schema.
- See §6 for the full pipeline + example prompt + schema.

#### Database schema (Postgres / Supabase)

This is the canonical DDL. Every migration in Batch 1 (initial schema) and Batch 12 (teacher tier activation) lands against this block. Indexes and check constraints are listed inline — copy them into the migration as-is unless you have a documented reason not to. RLS policies are described in prose below the DDL because they're long and Supabase-specific.

```sql
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
```

**Row-level security (Supabase RLS) — outline.** Enable RLS on every table above. Policy summary:

- `users`: a user can `SELECT` and `UPDATE` their own row only. Service-role bypasses (for admin tasks).
- `scores`: owner can do anything with their own scores. If `shared_with_studio` is set, members of that studio can `SELECT` (read-only).
- `analyses`: owner-only access. Plus: a teacher can `SELECT` analyses where `assignment_id` references an assignment whose `teacher_user_id = auth.uid()`.
- `assignments`: teacher (creator) can do anything; student (assignee) can `SELECT` and `UPDATE status` between `assigned → in_progress → submitted`.
- `studios`: owner can do anything; members can `SELECT` only.
- `verdict_corrections`: owner-only insert; service-role-only read (for the model retraining pipeline).
- `sync_events`: service-role-only read; user can insert their own rows only.

The exact policy SQL is generated in Batch 1 from this outline. Don't ship without RLS — Supabase's anon key is exposed in the client bundle.

#### Hosting

| Component | Provider | Cost (est at 1k users) |
|---|---|---|
| API + workers | Fly.io (2 small machines) | $50–100/mo |
| Postgres + Auth | Supabase Pro | $25/mo |
| Object storage | Supabase Storage or S3 | $10–30/mo |
| Claude API | Anthropic | $0.05–0.15 per OCR call → see §8 cost projections |
| CDN for score images | Cloudflare R2 (free tier covers initial scale) | $0–10/mo |

Total fixed infra at 1k MAU: ~$100/mo. Variable cost is the Claude API call per new score uploaded — roughly $0.05–$0.15 per analysis depending on image size and model tier. We cache score JSON aggressively so re-analyzing the same score uses the cached parse.

### 2.1 Offline & connectivity strategy

**The use case:** a student practicing in a school music room or rural area with weak/intermittent WiFi. School networks frequently block file uploads, throttle bandwidth, or drop large requests. We can't assume connectivity at the moment of practice.

**The architecture-level decision:**

| Pipeline stage | Online | Offline | Sync-later |
|---|---|---|---|
| Camera capture | ✅ | ✅ | n/a |
| Score OCR (Claude API) | ✅ | ❌ (requires API call) | Queue image, run OCR when online |
| Score editing / display | ✅ | ✅ (cached locally) | n/a |
| BPM calibration | ✅ | ✅ (on-device librosa.beat or simple FFT) | n/a |
| Audio recording | ✅ | ✅ | n/a |
| Audio analysis (librosa + DTW) | ✅ (server) | ❌ MVP / ✅ V2 (on-device port) | Queue audio, analyze when online |
| Result display | ✅ | ❌ MVP — analysis unavailable until sync | Push notification when result ready |

**MVP commitment:** Full offline *capture* (camera + audio recording + score viewing). Analysis still requires connectivity but is queued; the user gets the verdict whenever they're back online, surfaced via push notification.

**Local storage layout (mobile):**

- `scores/` — already-OCR'd scores cached as JSON for offline viewing/recording
- `pending_uploads/` — recorded audio + score_id + target_bpm tuples that need to sync
- `pending_ocr/` — sheet music images waiting for OCR

A small SQLite DB on-device tracks queue state (use `expo-sqlite` or `react-native-quick-sqlite`). Each pending item has: `local_id`, `type` (ocr | analysis), `created_at`, `attempts`, `last_error`, `payload_path`.

**Sync logic:**

- Foreground sync attempt every 30 sec when app is open + connected
- Background fetch (iOS BGTaskScheduler / Android WorkManager) for sync when app is closed
- Exponential backoff on failure (1 min → 5 min → 30 min → 2 hr)
- On 5 consecutive failures, surface "trouble syncing" banner and offer manual retry

**Audio file size estimate:** 4-min recording at 22.05 kHz mono, 16-bit PCM = ~10 MB. AAC compression knocks it to ~2 MB. Use AAC for the upload; keep WAV locally for re-analysis if needed.

**Storage budget on-device:** Cap pending uploads at 200 MB (≈100 recordings); warn user before they hit the cap. Old completed analyses get pruned after 30 days unless saved.

**V2: full on-device analysis.** Port the librosa pipeline to TFLite (onset detection model) + native code (DTW). Substantial work; defer until user signal demands it. The architecture above is designed to be a clean upgrade path: when on-device analysis ships, it slots in as the first attempt with server fallback.

**Edge case: school WiFi captive portal.** Some school networks redirect all HTTPS traffic to a sign-in page. Detect by HEAD-checking `apple.com/library/test/success.html` or our own ping endpoint; if response body is unexpected, mark as "captive portal" and surface to user with "WiFi requires sign-in — connect via browser then come back."

**Edge case: cellular data restrictions.** Surface a "use cellular for sync?" toggle in settings; default off. Otherwise large recordings could blow data caps.

---

### REST API surface (MVP)

```
POST   /v1/scores                    Upload sheet music image; returns score_id + parsed JSON
GET    /v1/scores/:id                Fetch score JSON
PATCH  /v1/scores/:id                Edit parsed score (user corrections)
DELETE /v1/scores/:id

POST   /v1/analyses                  Submit audio + score_id + target_bpm; returns analysis_id (queued)
GET    /v1/analyses/:id              Poll for status / fetch result
GET    /v1/analyses                  List user's analyses (paginated)

POST   /v1/calibration               Submit 2-sec calibration clip; returns detected BPM

POST   /v1/assignments               Teacher creates assignment for student
GET    /v1/assignments               List assignments (teacher: by studio; student: their own)

GET    /v1/me                        Current user + tier
POST   /v1/billing/checkout          Stripe checkout session
POST   /v1/billing/webhook           Stripe webhook handler
```

---

## 3. Feature List

### MVP (target: 8–12 weeks to first usable build)

| Feature | Description | Why in MVP |
|---|---|---|
| Sheet music photo capture | Camera screen with capture button + cropping/perspective correction | Core input; blocks everything else |
| Claude Vision OCR | Photo → structured score JSON (notes + rhythms) | Without this, no score-relative analysis |
| Score preview & edit | User confirms parsed score; can tap to fix wrong notes/rhythms | OCR will miss things; user must be able to correct without re-shooting |
| Manual BPM entry | User taps in target tempo (e.g. ♩=92) | Simplest path to usable feedback |
| 2-sec calibration clip | Alternative to manual BPM: user plays 2 seconds at their target tempo | Many students don't know exactly what tempo to set; this lets them set "their" tempo |
| Audio recording | Record up to 5 minutes; review/redo before submitting | Core input |
| Onset detection + DTW alignment | Server-side analysis pipeline | The actual product |
| Per-measure timing classification | Each measure → on / rushing / dragging / severe | Primary output |
| Annotated score view | Color-coded score showing which measures drifted | Visual interpretation of results |
| Tempo trend chart | Rolling-average BPM-deviation chart | Catches gradual drift the per-measure view doesn't surface clearly |
| One-line verdict | "You rushed in measures 8–12 by an average of 4 BPM" | Most users want the headline first |
| Free tier limits (3 analyses/month) | Stripe + Supabase RLS enforce | Monetization gate; lets free users still feel the product |
| Pro tier upgrade flow | Stripe checkout, App Store IAP later | Revenue |
| Auth (email + magic link) | Supabase Auth | User accounts for syncing analyses |
| Optional metronome during recording (visual + haptic) | A toggle in the recording flow turns on a metronome that plays alongside while you record. MVP modes: visual (border flashes on each beat) and haptic (phone vibrates on each beat, mobile only). Off by default. | Lets users actively try to match a click while recording, without breaking the "InTempo is *not* a metronome" positioning. Visual/haptic only — no audio click — to avoid mic bleed corrupting the analysis. |

### Accessibility & inclusive design (MVP requirements, not V2)

Accessibility constraints belong in the MVP because the entire app's primary feedback signal is color-coded (green / yellow / red verdict, color-coded annotated score). Without these constraints baked in from day one, a meaningful slice of the target audience can't use the product — and retrofitting accessibility post-launch is at least 3x the cost of building it correctly the first time.

The constraints below are non-negotiable acceptance criteria for any UI batch (5, 6, 7, 9). Treat them as part of the Definition of Done, not as polish.

**Color-blind safety (the big one).** Approximately 8% of men and 0.5% of women have some form of color-vision deficiency, and the most common form (red-green) maps almost exactly onto our verdict colors. This is the single most likely accessibility failure mode for InTempo specifically.

- Never communicate a verdict by color alone. Every green/yellow/red badge must also carry a non-color signal: an icon (✓ / ~ / ✗), a text label ("on tempo" / "trending" / "rushing"), and/or a pattern (solid / striped / hatched fill on the annotated score).
- Use a color-blind-safe palette for the verdict colors. Don't use pure red/green; use blues for "good" and oranges for "bad" if you want a single hue contrast that works across deuteranopia/protanopia/tritanopia. Or keep the green/red as cultural shorthand but pair them with the icon and text every time so the color is redundant, not load-bearing.
- Run every verdict UI through a color-blind simulator (the Stark Figma plugin or `colorblind-simulator` CLI) before declaring DoD. Take a screenshot under each simulation; commit the screenshots to `/docs/a11y/` for the regression record.

**Screen reader support.** VoiceOver (iOS) and TalkBack (Android) must read every verdict and chart. The annotated score isn't a static image — it's information. Implementation:

- Every per-measure verdict has an `accessibilityLabel` of the form `"Measure 8: rushing by 6 percent"`.
- The headline verdict is announced first; per-measure detail is reachable on swipe.
- The trend chart has an accessibility summary (`"Tempo drifted 8% faster between measures 4 and 12, then stabilized"`) plus a navigable data-table fallback for the underlying numbers.
- All actionable buttons have explicit labels — never just an icon.

**Touch target sizing.** iOS HIG requires 44×44 pt minimum; Android Material requires 48×48 dp. Apply both — the smaller of the two app instances determines what's required, and React Native shares the layout. Especially relevant for the per-measure tap-to-drill-down interactions in the annotated score view.

**Font scaling (Dynamic Type / Font Scale).** Both platforms let users scale text up to 200%. The verdict screens must reflow, not clip, at the largest scale. Test at the largest dynamic-type setting on iOS as a Definition-of-Done check.

**Reduced motion.** Honor `prefers-reduced-motion` (web) and the iOS/Android equivalent. The trend chart's animated draw-in should be instant for users who've requested reduced motion. Same for any spring/bounce on screen transitions.

**Hearing-impaired and deaf musicians.** This is an audio-feedback app, but blind reliance on audio cues for *the app itself* (notification chimes, calibration "ready" beep) excludes deaf musicians who use the visual + tactile feedback we already have. Every audio cue from the app must have a visual + haptic equivalent. Note: this is not the same as analyzing audio they can't hear — that part of the product still works fine; they just need the chrome around it not to assume hearing.

**Captions for any onboarding video.** If GTM ships a 30-second tutorial video on the landing page or App Store, it needs captions. Auto-generated captions (YouTube auto-cap or Whisper) are an acceptable starting point if a human reviews them.

**WCAG 2.1 AA contrast** for all text — 4.5:1 for body, 3:1 for large text. Verify with a contrast checker, not by eye. The most common failure is gray subtitle text on white that "looks fine" but reads at 3.2:1 and fails.

**What's deliberately deferred to V2:**
- Switch control / Voice Control fine-tuning beyond defaults
- Right-to-left language layout (English-only at MVP)
- Cognitive accessibility (simplified "easy mode" UI)

### V2 (post-MVP, target: months 4–7)

| Feature | Why deferred |
|---|---|
| Slur detection | Tougher signal-processing problem; need real recordings to tune threshold. Many MVP pieces will be detaché-heavy enough that this is V2. |
| Articulation-aware tolerance bands | Slur passages need different tolerance than detaché; ties to slur detection |
| Side-by-side comparison: today vs 1 week ago | Storage + UI work; not core to "is my tempo OK now" |
| Practice streak / gamification | Won't drive initial conversion; can come later |
| Native iOS app (in addition to RN) | RN is fine for MVP; revisit if RN audio latency becomes an issue |
| Teacher dashboard + assignment workflow | Full build is V2 (see workflow detail below); MVP DB schema already accommodates so no migration later |
| Multiple score formats (MusicXML import) | Solves an edge case; OCR covers 90% of users |
| Pizzicato detection | Different attack envelope than bowed; needs separate threshold model |
| Apple Watch quick-record | Cool but not core |
| Audio metronome (with headphone gate) | Audio click track during recording, but only when headphones/earbuds are connected so the click doesn't bleed into the mic. Detect headphone presence via the OS audio-route API and gate the audio mode behind it. Visual + haptic stay available everywhere. |

### Teacher tier workflow (V2 build, MVP-ready data model)

The teacher tier is a small app inside the app. Worth specifying explicitly even though the build is V2 — the DB schema in §2 already accommodates it so we don't migrate later.

**Onboarding:**

1. Teacher signs up, picks "I'm a teacher," creates a studio. Studio gets a 6-character invite code (e.g., `MTLO7Q`).
2. Teacher shares the code with students via text/email.
3. Student signs up (free tier), enters the invite code, gets bumped to `student_via_teacher` tier (Pro features unlocked, billing on the studio).
4. Teacher can also pre-create student accounts via email invite — student gets a one-tap onboarding link.

**Assignment creation flow (teacher):**

1. Teacher hits "+" on the studio dashboard.
2. Picks one or more students.
3. Picks a piece — either uploads new sheet music (OCR'd as usual) or picks one already in the studio's score library.
4. Sets target tempo + due date + optional instructions ("Focus on the agitato passage at measure 32").
5. Teacher can mark assignment as "individual" (each student plays their own copy) or "shared" (used for ensemble work).

**Assignment fulfillment flow (student):**

1. Student opens app → "Assigned to me" tab → sees pending assignments with due dates.
2. Tap an assignment → opens the assigned score with the teacher's target BPM pre-filled (no calibration needed unless they want to override).
3. Student records, gets analysis, hits "Submit to teacher."
4. Submission ties the analysis to the assignment (`analyses.assignment_id`); status = `submitted`.

**Teacher review flow:**

1. Studio dashboard shows submitted assignments highlighted.
2. Teacher opens a submission — sees the analysis (annotated score, trend chart, verdict) plus the student's audio playback.
3. Teacher leaves notes in `assignments.teacher_review_notes`. Student gets a notification.
4. Status transitions: `assigned → in_progress` (when student starts) `→ submitted → reviewed`.

**Edge cases / failure modes:**

- **Student records but doesn't submit.** Submission is explicit — student can record/redo locally without their teacher seeing each take. We only push to the teacher on "Submit."
- **Student leaves the studio.** Their existing analyses + assignments stay in their account; their tier drops back to `free` (or `pro` if they had one). Studio seat is freed.
- **Teacher revokes a student.** Same as above. Notify student via email, give 7-day grace period to download their data.
- **Studio hits seat cap.** Teacher gets prompted to upgrade seats ($19.99 covers 25; additional 25-seat blocks at +$10/mo) or remove inactive students.
- **Score sharing.** A teacher uploading a score for an assignment can mark it `shared_with_studio` — students see it in their score library too. This avoids each student having to re-photograph the same piece.

**MVP commitment:** ship enough of this in the schema that a follow-on build adds the workflow without migrations. The actual UI (teacher dashboard, assignment creator, review screen) waits for V2.

---

### V3 (long-term, months 8+)

| Feature | Why far-out |
|---|---|
| Click-aware onset detection (audio metronome without headphones) | Speaker-played metronome with the click windows masked from onset detection before analysis runs — since we generated the click track, we know exactly when each click fires. Real signal-processing work; only worth building if V2 telemetry shows meaningful demand from users who want audio metronome but won't use headphones. |
| Wind / brass instrument support | Different onset envelopes; requires retuning entire detection layer |
| Pitch-accuracy analysis (not just timing) | Doubles the scope of the analysis layer; CREPE or YIN pitch tracking, plus reading pitch from the score |
| Dynamics / articulation feedback | Even larger scope; requires loudness analysis tied to dynamic markings on score |
| Group ensemble analysis | Multi-track recording, separation; significantly harder |
| Web-based teacher review portal | After teacher tier proves out via mobile |
| Assigned-piece library (curated audition rep) | Once we have content partnerships |
| Integration with Tonara / SmartMusic / Trala | Strategic; only after we have leverage |

---

## 3.5 Design System & Visual Direction

This section exists because InTempo is built fully via vibe coding (Claude as the implementing engineer with no human designer). Without explicit visual guardrails, AI-generated UI drifts into "tech demo aesthetic" — gradients, glowing buttons, shadows on everything, three border radii, emoji icons, generic Tailwind starter look. The fix is to remove every taste decision from Claude's hands by pre-deciding it here. Claude implements; never invents. Read this before any UI batch (5, 6, 7, 9).

A rendered preview of the aesthetic lives at `/docs/intempo-design-preview.html` in the repo (committed in Batch 0). Open it in a browser to calibrate your eye before reading the spec.

### Aesthetic direction

**Linear-leaning with warmth.** Charcoal text on a near-white warm background, generous whitespace, subtle borders instead of shadows, and a single deep-amber accent that does the brand work. Verdict colors (green / amber / red) are **quarantined to the verdict UI only** — they never appear in chrome, navigation, buttons, or any non-verdict context. This restriction alone is what separates clean apps from messy ones; do not negotiate it.

Reference apps to study screen-by-screen before designing anything: Linear, Things 3, Bear, Reflect, Cron / Notion Calendar, Spike Email. Install them, screenshot the moments that feel right, paste those screenshots when asking Claude to match density, hierarchy, and restraint.

### Color tokens

Use these exact hex values. No off-spec colors in any UI batch.

| Token | Hex | Usage |
|---|---|---|
| `--bg-page` | `#FAFAF7` | Default app background. Warm off-white, not pure white (pure white feels clinical). |
| `--bg-surface` | `#FFFFFF` | Cards, modals, raised surfaces. |
| `--bg-secondary` | `#F2EFE8` | Subtle elevation contrast (e.g. behind grouped settings). |
| `--border` | `#E8E6E0` | Default 1px border on cards, inputs, dividers. |
| `--border-strong` | `#D6D3CB` | Hover/focus state for borders. |
| `--text-primary` | `#0F0E0C` | Body and heading text. Near-black, not pure (pure black is too harsh). |
| `--text-secondary` | `#6B6862` | Subtitles, secondary metadata, axis labels. |
| `--text-tertiary` | `#A8A39B` | Hints, placeholder text, disabled state. |
| `--accent` | `#B8651A` | The single brand accent. Deep amber / terracotta. Used for primary CTAs, focused inputs, the back-arrow link, the visual-metronome indicator, the trend-chart peak marker. |
| `--accent-soft` | `#FAEEDA` | Tinted accent background for selected/active states. |
| `--verdict-on` | `#1F8A4C` | Verdict UI only. "On tempo" measures, badges, chart markers. |
| `--verdict-mid` | `#D69E2E` | Verdict UI only. "Trending" / yellow band. |
| `--verdict-bad` | `#C53B3B` | Verdict UI only. "Rushing" / "dragging" / red band. |

Do not introduce additional colors. If a screen needs visual distinction, use the existing tokens at different weights or sizes — not new colors. Verdict tokens never leak into navigation, buttons, banners, or marketing surfaces.

### Typography

**Single typeface: Geist Sans** (free from Vercel; load via Google Fonts). One typeface, one font family. No Inter, no SF Pro, no Roboto fallback at runtime — Geist is the only correct font.

Sizes follow this scale; do not invent sizes between these values:

| Token | Size | Weight | Usage |
|---|---|---|---|
| `text-display` | 40–44px | 500 | The verdict number, the recording timer. |
| `text-headline` | 28–32px | 500 | Verdict word ("Slight rush"), screen titles in hero state. |
| `text-title` | 18–20px | 500 | Card titles, section headings inside screens. |
| `text-body` | 14–16px | 400 | Default UI text, descriptions, button labels. |
| `text-caption` | 13px | 400 | Secondary text, axis labels, support copy. |
| `text-label` | 11–12px | 500 + uppercase + 0.06–0.08em letter-spacing | Card eyebrow labels ("Tempo verdict", "Annotated score"). |

Weights: **400 and 500 only.** Never 600 or 700 — they look heavy and dated against a clean palette. The display-weight feel comes from size + tabular numerals + tight letter-spacing (`-0.02em` on display sizes, `-0.01em` on headlines), never from heavier weight.

Numerals: tabular figures (`font-variant-numeric: tabular-nums`) on every timer, BPM value, percentage, and stat — they prevent jitter when values change live.

Sentence case throughout. Never Title Case, never ALL CAPS except in `text-label` (which is the explicit exception).

### Spacing & shape

**8pt grid.** Every margin, padding, and gap is a multiple of 4. The standard rhythm: 4, 8, 12, 16, 20, 24, 32, 48. No `padding: 13px` anywhere.

**Border radius scale** — use only these four values:

| Token | Radius | Usage |
|---|---|---|
| `radius-sm` | 6px | Buttons, badges, small interactive elements. |
| `radius-md` | 8px | Inputs, segmented controls, small cards. |
| `radius-lg` | 12px | Cards, content panels. |
| `radius-xl` | 16–20px | Modals, sheet overlays. |

Pills (full-rounded) only for badges with very short text. Never mix random radii.

**Borders, never shadows.** All elevation is `1px solid var(--border)`. No `box-shadow` anywhere except the focus ring on inputs (`box-shadow: 0 0 0 2px var(--accent-soft)`). Drop shadows are the #1 visual tell of AI-generated UI; do not use them.

### Motion

Framer Motion (or React Native Reanimated on mobile) with this exact specification:

| Motion | Duration | Easing | Usage |
|---|---|---|---|
| Default transition | 200ms | `ease-out` | Hovers, taps, layout shifts, state toggles. |
| Page transition | 280ms | `ease-out` | Route changes. Cross-fade with 8px translate. |
| Verdict reveal | 400ms | spring (stiffness 220, damping 26) | The headline number scaling 80% → 100%, opacity 0 → 1. The single exceptional motion in the app. |
| Stagger | 40ms between items | linear | Per-measure verdicts cascading in left-to-right after the verdict reveal. |
| Reduced motion | instant | — | All animations become opacity-only fades. Honor `prefers-reduced-motion` and the iOS/Android equivalents. |

The verdict reveal is the moment users will screenshot and share. Build it carefully and do not let Claude pick the easing values — specify exactly what's above.

### Component primitives

Lock in exact specs for the four components that show up across every screen:

**Button (primary).** `height: 44–48px` · `radius-sm` · `background: var(--accent)` · `color: #FFFFFF` · `font: text-body weight 500` · full width by default · `padding: 0 16px`. Pressed state: `background` darkens 8%; no scale animation.

**Button (ghost).** Same dimensions · `background: transparent` · `border: 1px solid var(--border)` · `color: var(--text-primary)`. Pressed state: `background: var(--bg-secondary)`.

**Button (destructive / stop).** Used only for the recording-stop control. `background: var(--text-primary)` · `color: #FFFFFF`. Includes a 11×11px white square as the stop glyph.

**Card.** `background: var(--bg-surface)` · `radius-lg` · `border: 1px solid var(--border)` · `padding: 16–20px`. Stack cards with `12px` gap between them. Cards never have shadows.

**Eyebrow label.** `text-label` followed by 8–12px gap to the content below. Always lives inside the card it labels.

### Icons

Use **Lucide** (or **Phosphor**) only. No emoji as UI icons. No custom hand-drawn icons in v1. Icon size: 16px in body text, 20px in nav and buttons, 24px max for decorative. Stroke width: 1.5px (matches the airy aesthetic; default 2px reads heavier than we want).

### The don't-do list

These are non-negotiable. Paste this list at the top of any prompt where Claude is generating UI:

- No gradients anywhere except the verdict-reveal background flash.
- No drop shadows on any UI element (focus ring on inputs is the one exception).
- No emoji as UI icons — Lucide or Phosphor only.
- No bright tech-blue. No purple. The accent is amber, period.
- No glassmorphism, blur effects, frosted glass.
- No animated backgrounds, particle effects, parallax.
- No hover-scale animations on cards or buttons.
- No "neumorphism" anything.
- No more than one accent color visible per screen.
- Verdict colors (green / amber / red) appear nowhere outside the verdict UI.
- No 600 or 700 font weights.
- No font sizes outside the documented scale.
- No off-spec border radii — use only the four documented values.
- No `setInterval` for any timing-critical UI (metronome, recording timer); use `requestAnimationFrame` + drift-corrected `Date.now()` or `audioContext.currentTime`.

Most AI-generated UI fails by adding things, not by missing things. The list above covers ~90% of failure modes. When reviewing Claude's output, scan against this list first.

### Per-screen design notes

Six critical screens. Each gets a short brief plus the reference style the implementer should match.

**Splash / app-load.** **Default: instant load, no splash screen at all.** Modern apps (Linear, Things, Cron) skip the dedicated loading screen because iOS already shows a static launch image in the brief moment between tap and app ready. A separate "loading" screen with three bouncing dots is dated.

The splash only renders if the cold-start takes longer than 300ms — typically only on first launch (Supabase session restore + recent-piece warmup) or after the app has been killed and is restoring state. When it does render, it's quietly branded:

1. **Wordmark** — "InTempo" in Geist 500 at 32px, near-black, centered.
2. **Animated pendulum** — a refined metronome-pendulum SVG centered below the wordmark. The composition has six visual elements:

   - **Suspension beam** — a 2px-thick horizontal black line across the top of the SVG, suggesting the pendulum hangs from a fixed mount.
   - **Triangular hanger** — a small filled black triangle dropping from the center of the beam to the pivot.
   - **Pivot ring** — a 4px-radius circle at the pivot point: warm-white fill, 1.5px black stroke (a ring, not a solid dot — looks like an actual jewel-bearing pivot).
   - **Rod and weight (the swinging assembly)** — a 2px black rod with rounded caps, a small 4×6px black rectangular collar where the rod meets the weight, and the amber weight itself: a 13px-radius `var(--accent)` circle with a tiny offset light-amber ellipse (3.5×2.5px, `var(--accent-soft)` at 0.55 opacity) suggesting a subtle highlight on a polished metal sphere. Two solid colors only — no gradients — but the layered shapes give the weight a sense of physical depth.
   - **Swing-path arc** — a fixed dotted gray arc beneath the weight's lowest point, plus three small tick marks at the extremes and bottom-center (faint, `border-strong` color) suggesting the beat positions.
   - **Motion ghost trails** — two faint amber circles (same size as the weight) at the extreme positions of the swing, opacity 0–0.18, animating in and out of visibility synced to the swing. They give a "long exposure" sense of motion when the pendulum is swinging without literally trailing the weight.

   The swinging assembly rotates ±17° around the pivot at 1.1s per half-swing — full tick-tock cycle is 2.2 seconds, roughly ♩=55 BPM. Calm and reassuring rather than urgent. Easing: `cubic-bezier(0.42, 0, 0.58, 1)` — sinusoidal-feeling, slow at the extremes, faster through the middle, like a real pendulum. The ghost trails fade in toward the same extreme the weight is approaching (`pendulum-trail` keyframe peaks at 100% with 0.18 opacity, fades back near the swing-back). The left trail uses `animation-delay: -1.1s` to fire on the opposite phase. `prefers-reduced-motion` cancels both animations and renders the pendulum static at 0°.
3. **Context line** — "Picking up [piece title]" using the most recently opened piece's title, in 13px text-secondary color. If no piece exists yet (first launch), use "Setting things up" instead.
4. **Progress line** — a 2px-tall horizontal line spanning the full width at the bottom of the screen. Background `var(--border)`, foreground `var(--accent)` filling proportionally as data loads. Not a fake animated progress bar — actual loading progress where possible.

Reference SVG structure (matches `docs/intempo-design-preview.html`):

```svg
<svg width="140" height="180" viewBox="0 0 140 180" aria-hidden="true">
  <!-- suspension beam -->
  <line x1="36" y1="4" x2="104" y2="4" stroke="#0F0E0C" stroke-width="2" stroke-linecap="round"/>
  <!-- triangular hanger -->
  <path d="M 62 4 L 78 4 L 70 14 Z" fill="#0F0E0C"/>
  <!-- swing-path arc with tick marks -->
  <path d="M 30 162 Q 70 176 110 162" fill="none" stroke="#E8E6E0" stroke-width="1" stroke-dasharray="1 4"/>
  <line x1="30" y1="161" x2="30" y2="166" stroke="#D6D3CB" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="70" y1="173" x2="70" y2="178" stroke="#D6D3CB" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="110" y1="161" x2="110" y2="166" stroke="#D6D3CB" stroke-width="1.2" stroke-linecap="round"/>
  <!-- ghost trails at extremes -->
  <circle class="pendulum-trail pendulum-trail-left" cx="35.8" cy="135" r="13" fill="#B8651A"/>
  <circle class="pendulum-trail" cx="104.2" cy="135" r="13" fill="#B8651A"/>
  <!-- pivot ring (fixed; not in swing group) -->
  <circle cx="70" cy="16" r="4" fill="#FAFAF7" stroke="#0F0E0C" stroke-width="1.5"/>
  <!-- swinging assembly -->
  <g class="pendulum-swing">
    <line x1="70" y1="20" x2="70" y2="124" stroke="#0F0E0C" stroke-width="2" stroke-linecap="round"/>
    <rect x="68" y="123" width="4" height="6" rx="0.5" fill="#0F0E0C"/>
    <circle cx="70" cy="142" r="13" fill="#B8651A"/>
    <ellipse cx="65.5" cy="137.5" rx="3.5" ry="2.5" fill="#FAEEDA" opacity="0.55"/>
  </g>
</svg>
```

```css
.pendulum-swing {
  transform-origin: 70px 16px;
  transform-box: view-box;
  animation: pendulum-swing 1.1s cubic-bezier(0.42, 0, 0.58, 1) infinite alternate;
}
.pendulum-trail {
  animation: pendulum-trail 1.1s cubic-bezier(0.42, 0, 0.58, 1) infinite alternate;
}
.pendulum-trail-left { animation-delay: -1.1s; }

@keyframes pendulum-swing {
  from { transform: rotate(-17deg); }
  to   { transform: rotate(17deg); }
}
@keyframes pendulum-trail {
  0%   { opacity: 0; }
  85%  { opacity: 0; }
  100% { opacity: 0.18; }
}
@media (prefers-reduced-motion: reduce) {
  .pendulum-swing { animation: none; transform: rotate(0); }
  .pendulum-trail { animation: none; opacity: 0; }
}
```

Implementation note: the splash component renders behind the home screen, hidden by `opacity: 0` initially. If the app is still loading after 300ms, fade in the splash (`opacity: 0 → 1` over 200ms ease-out). When ready, fade out and reveal home. This way a fast load shows nothing transitional. On React Native, use `react-native-reanimated` with the same easing curve for the pendulum (`Easing.bezier(0.42, 0, 0.58, 1)`); the SVG renders via `react-native-svg`.

**Score capture (camera).** Full-bleed camera viewfinder with a 4-corner crop guide that auto-detects the score's corners (perspective-correction visualization). Bottom: a single round capture button + retake. No chrome. Reference: how iOS Notes scans documents.

**Score preview & edit.** The OCR'd score rendered in a simplified notation (notes as sticks with note-heads) with tap-to-edit on any wrong note. Below: the metadata fields (title, composer, time signature, target BPM) in a single card. Reference: Things 3 task editor — the way it feels effortless to fix a small thing.

**Recording flow.** Big timer in display weight, target BPM secondary, optional metronome card, live waveform card, dark stop button at bottom. The recording state is communicated through the small live-dot + "Recording" eyebrow, never through scary red chrome. See the design preview HTML.

**Verdict screen.** This is THE moment. Eyebrow → display headline (the verdict word) → plain-English subtitle → annotated-score card → trend-drift card → primary CTA + ghost CTA. Whitespace is generous; no scrolling on the first viewport for the headline + annotated score. The annotated-score card is what users will screenshot. See the design preview HTML.

**Per-measure detail.** A scrollable list, one row per measure. Each row: measure number (left, secondary text) · timing-deviation bar (center, spans middle of the row, dot or fill positioned ahead/behind a center line) · BPM offset (right, color-coded). No charts here — the list is dense by design. See the design preview HTML.

**Paywall / upgrade.** The hardest screen to do well in vibe coding. Three things only: (1) one-line value prop ("Unlimited analyses, saved history, cloud sync"), (2) tier comparison as a single card showing what's free vs Pro with checkmarks (no fake-pricing-table look), (3) the CTA. No testimonials, no fake badges, no "limited time" countdown. Reference: Things 3 and Reflect both nail the calm paywall.

### Language: musician, not engineer

A constraint that isn't visual but governs what every UI batch writes. The principle: **words tell the musician what happened; the bar visualization tells them how much.** Numbers are an engineer abstraction users have to translate into feeling — words land directly.

**Verdict labels — five-state vocabulary.** Every per-measure and headline verdict picks from one of these five states:

| State | When | Color | Use cases |
|---|---|---|---|
| `on_tempo` | Within ±2 BPM of target | `--verdict-on` (green) | "On tempo" |
| `slight_rush` | +3 to +5 BPM faster than target | `--verdict-mid` (amber) | "Slight rush" |
| `rushing` | More than +5 BPM faster | `--verdict-bad` (red) | "Rushing" |
| `slight_drag` | −3 to −5 BPM slower than target | `--verdict-mid` (amber) | "Slight drag" |
| `dragging` | More than −5 BPM slower | `--verdict-bad` (red) | "Dragging" |

Headline verdict for the whole piece can be more descriptive: "Steady" / "Slight rush" / "Rushing in measures 8–12" / "Drifting late" / "All over the place" — but always sentence-case English, never jargon.

**Numbers are dev-mode only.** Percentages, BPM offsets, milliseconds, timing deviations in numeric form — none of it appears in production UI. They're fine in:
- Internal logs and Sentry breadcrumbs
- Dev-mode debug overlays (toggleable in development builds, never shipped)
- The Batch 3 tuning dashboard
- Telemetry events sent to Posthog

Two exceptions where numbers do appear in production UI:
- The recording timer (e.g., `00:43`) — necessary, the user is watching elapsed time.
- The target BPM display on the recording screen (e.g., `Target ♩ = 60 BPM`) — necessary, the user set this.

Everywhere else, the rule is words + bars, not numbers.

**Musical language conventions:** "ahead of the beat" not "early"; "behind the beat" not "late"; "rushing" not "tempo positive deviation"; "dragging" not "tempo negative deviation"; "on tempo" not "0% offset". Sentence case throughout; never Title Case.

**Tap-to-reveal** is the right pattern when a power user wants the actual number. The per-measure detail rows show "Slight rush" by default; long-press or tap-and-hold reveals the BPM offset for that one measure. Don't expose this on first launch — it's a power-user affordance, not a default.

### Art-director discipline (the human's job)

Vibe coding produces clean design only when the human has discernment to reject ugly. Concretely:

1. After every UI batch, screenshot every screen and lay them next to one of the reference apps (Linear, Things 3). Reject anything that doesn't match the density, restraint, and confidence of the reference.
2. Don't accept "it works." Accept "it's beautiful." Iterate the same screen up to 10 times if needed.
3. When pushing back, paste the reference screenshot. "Match the spacing and hierarchy in this screenshot" produces dramatically better output than "make it cleaner."
4. Run a color-blind simulator (Stark plugin or `colorblind-simulator` CLI) on every verdict screen before declaring DoD. Save the screenshots to `/docs/a11y/` per §3 accessibility requirements.

### App icon strategy

Do not try to vibe-code the app icon. Two acceptable paths:

1. **Fiverr / 99designs:** $200–500 for a contracted icon. Brief: "minimalist app icon, single geometric glyph representing music timing, deep amber `#B8651A` on warm white, iOS app icon at 1024×1024, no treble clef, no headphones, no text."
2. **Midjourney iteration:** prompt `minimalist app icon, single geometric glyph, music timing, deep amber on warm white, iOS app icon, no text, no clef, no headphones, professional, restrained --ar 1:1 --style raw`. Generate 30–50 candidates; pick the strongest two; refine.

The icon is too important to compromise on. It's the difference between getting tapped on the App Store and not. Budget for it.

### App Store Preview video

15–30 second autoplay video on the App Store listing. Apps with autoplay video convert ~35% better than apps without. No narration (autoplays muted). Shows the core flow:

1. Photo of sheet music being captured (1.5s)
2. Recording in progress with the live waveform (3s)
3. Verdict reveal with the headline + annotated score (4s)
4. Per-measure drill-down scrolling (3s)
5. End frame: app icon + tagline (1.5s)

Budget $200–800 to a freelance motion designer on Fiverr, or shoot it yourself with QuickTime screen recording on the iOS simulator and edit in iMovie. Lands in Batch 13 (App Store launch).

### Definition-of-Done additions for UI batches

Every UI batch (5, 6, 7, 9) gets these added to its DoD checklist:

- ✅ All colors used are from the documented token set; no off-spec hex values
- ✅ All font sizes are from the documented scale; weights are 400 or 500 only
- ✅ All radii are from the four-value scale
- ✅ Zero `box-shadow` properties except focus rings
- ✅ Zero gradient properties except the verdict-reveal background
- ✅ All animations match the documented motion spec
- ✅ Color-blind simulator screenshots committed to `/docs/a11y/`
- ✅ Side-by-side comparison screenshots vs the reference app committed to `/docs/design/`

---

## 4. Audio Analysis Deep Dive

This is the engineering core. Get this section right and the rest of the product is straightforward.

### Critical recording-environment constraint: no audio bleed in MVP

The whole pipeline assumes the recorded audio contains **only** the player's instrument. Anything else — speaker playback, ambient music, a metronome click through phone speakers — registers as phantom onsets in librosa's onset detector and corrupts the analysis.

This constrains the metronome feature (see §3 MVP table). In MVP, the optional metronome ships as **visual** (screen border flashes on each beat) or **haptic** (phone vibration on each beat — mobile only) modes only. **No audio click track plays through the device speaker during recording.** V2 adds an audio click mode, gated by detection of connected headphones/earbuds via the OS audio-route API. V3 adds click-aware onset detection that masks known click windows so audio mode works without headphones.

What the analysis pipeline needs to know about metronome state: the `analyses.metronome_mode` column (see §2 DDL) records `'off' | 'visual' | 'haptic' | 'audio_with_headphones'`. The pipeline does **not** branch on this value in MVP — visual and haptic modes don't touch the audio signal at all, so the existing analysis logic is unchanged. The column exists for telemetry (do users actually use the metronome?) and to teach the pipeline the audio-mode handling later.

### Three threshold layers

The naive approach — measure each note's onset deviation from the target tempo and classify it — fails badly because:
- Real human playing has noise on every note (5–20ms scatter is normal even at high level)
- Slurred notes don't have clean onset signals
- "Rushing" is a *trend* across multiple notes, not a single early note

We use three layered thresholds.

**Layer 1: Onset detection sensitivity.** This is a librosa parameter, not a tolerance band. Tune `delta` (peak-pick threshold) and `pre/post_max` (peak-pick window) so we detect every real note attack but reject vibrato wobble and bow noise. For double bass specifically, the low register requires lower `delta` (~0.05–0.07) than treble strings (~0.10–0.12).

**Layer 2: Slur detection layer.** When the score has a slurred passage, we *suppress* per-note timing checks within the slur and only check the slur's *boundary* notes. Inside the slur, the player has musical license to redistribute time. Slur detection itself is V2; in MVP we either (a) require the user to mark slurs in the score-edit step, or (b) only analyze detaché passages.

**Layer 3: Rushing/dragging tolerance bands.** After alignment, each note has a delta in milliseconds. We classify:

| Band | Threshold (% of beat duration at target BPM) | Color |
|---|---|---|
| **On** | within ±5% of beat | green |
| **Slight rush/drag** | ±5% to ±10% | yellow |
| **Rush/drag** | ±10% to ±20% | orange |
| **Severe** | beyond ±20% | red |

At 120 BPM (beat = 500ms), 5% = 25ms, 10% = 50ms, 20% = 100ms. These are starting values; need real-world tuning (see §13 Open Questions).

### Rolling-average trend detection

Per-note classification answers "did this note drift?" but the more important question is "are you systematically rushing through the page?" For that we use a rolling average:

- Compute the per-note delta in *signed BPM equivalent* (positive = ahead, negative = behind).
- Apply a rolling window of ~8 notes (or 2 measures, whichever is longer).
- The trend line on the chart shows whether the rolling deviation is systematically positive (rushing) or negative (dragging) across the piece.
- We surface the *largest contiguous run* of same-sign deviation in the verdict: "You rushed across measures 14–22, peaking at +6 BPM."

This catches the dominant failure mode that a per-note view misses: gradual drift.

### 2-second calibration clip flow

Many students don't know "♩=92 vs ♩=104" by feel. The calibration flow:

1. App says "Play 2 seconds at the tempo you want to be analyzed at. Just two notes will do." (or 4 quarter notes if they prefer)
2. User records.
3. `librosa.beat.beat_track` extracts the inferred BPM.
4. Display: "Detected ♩=98. Use this?" with options to tweak.

Why 2 seconds: long enough to detect 2–3 onsets reliably, short enough that users will actually do it. Single-onset detection is too noisy.

#### Calibration edge cases (full spec)

The happy path is one paragraph; the edge cases are most of the engineering. Get these right or users will bounce on first use.

| Failure mode | Detection signal | Behavior |
|---|---|---|
| **Clip too quiet** | Peak amplitude below −24 dBFS, or RMS below −36 dBFS | Reject. Toast: "Couldn't hear that — move closer to the mic and try again." Keep button visible. |
| **Clip too short** (<1.0 sec) | Recording duration | Reject. Toast: "Hold a bit longer — at least 2 seconds." |
| **Clip too long** (>5.0 sec) | Recording duration | Truncate to first 4 seconds and proceed. Show a one-time tooltip: "We only need a couple seconds." |
| **Fewer than 2 onsets detected** | `len(onset_frames) < 2` | Reject. Toast: "We didn't hear at least 2 notes — try again with 3 or 4 quarter notes at your tempo." |
| **More than 8 onsets detected** | `len(onset_frames) > 8` | The user crammed too many notes into 2 seconds — likely played 16ths or panicked. Use the BPM but also show a confirmation: "Detected ♩=140. That seems fast — is that right?" |
| **Octave error: detected BPM is exactly 2× or 0.5× the intended** | Inter-onset variance high relative to median | Show both options: "Did you mean ♩=120 or ♩=60?" with quick-select buttons. |
| **Inconsistent inter-onset intervals** | Coefficient of variation across IOIs > 0.30 | Reject. "The notes weren't evenly spaced — try playing a steady ♩=quarter note pattern." |
| **High background noise / SNR too low** | Onset detection returns more onsets in pre/post silence than during playing | Reject. Toast: "Too noisy — find a quieter spot and try again." |
| **Player chokes / nervous take** (very quiet first note, louder rest) | Amplitude variance across detected note windows >70% | Use the BPM if ≥3 onsets were clean; flag with: "Detected ♩=92. Use this?" Don't re-prompt — they want to move on. |
| **Detection returns implausibly slow tempo** (<40 BPM) or fast (>240 BPM) | Out of musical range | Reject. "That tempo seems out of normal range; please try again or enter manually." |
| **librosa.beat.beat_track fails outright** (returns 0 or NaN) | Exception or invalid output | Fall back to inter-onset interval median: BPM = 60 / median_IOI. If that also fails, fall back to manual entry. |
| **User tapped record but never played** | Total energy below silence threshold across whole clip | Reject silently after 4 seconds; show "Tap record again when you're ready." |

**Detection thresholds (initial values, for tuning):**

```python
CALIBRATION_MIN_DURATION_S = 1.0
CALIBRATION_MAX_DURATION_S = 5.0
CALIBRATION_MIN_PEAK_DBFS = -24
CALIBRATION_MIN_RMS_DBFS = -36
CALIBRATION_MIN_ONSETS = 2
CALIBRATION_MAX_ONSETS = 8
CALIBRATION_IOI_CV_MAX = 0.30  # coefficient of variation threshold
CALIBRATION_BPM_MIN = 40
CALIBRATION_BPM_MAX = 240
CALIBRATION_OCTAVE_AMBIGUITY_THRESHOLD = 0.20  # below this, offer 2x/0.5x
```

These belong in remote config so we can tune without releasing.

**UX rule:** never reject silently and never reject more than twice in a row. After two rejections, switch the UX to "tap your tempo" (a tap-to-set-BPM button) — don't trap the user in a calibration loop.

**Skip-calibration path:** if the user fails twice or actively dismisses, the manual BPM entry is right there. Don't make calibration mandatory. The app should be usable even if calibration never works on a particular phone.

### Slurred passages — different rules

In a slurred passage (one bow stroke across multiple notes), the *boundaries* of the slur are when the bow changes direction; everything between is musically free. Our analysis:

- **Boundary notes** (first note of the slur, first note after the slur ends): held to standard tolerance bands.
- **Interior slurred notes**: NOT timed individually. We measure the *total duration* of the slur vs the score-expected duration; if the whole slur fits within ±15% of expected, the player is fine.
- This is musically correct (a player choosing to slightly redistribute time within a slur is using musicianship, not "rushing") and avoids spurious "rushing" flags.

Detection of slurs in MVP comes from the score (Claude OCR returns `slur: {start: noteIdx, end: noteIdx}`); detection from the *audio* (i.e. confirming the player actually slurred) is V2.

### Détaché vs slurred classification (in audio)

In V2, we distinguish detaché from slurred passages in the *recording* itself — sometimes the player slurs when the score says detaché, or vice versa. Heuristics:

- **Detaché:** clean onset spike before each note; brief amplitude dip between notes
- **Slur:** continuous spectral energy across notes; pitch changes without onset envelope spike

Implementation: combine `librosa.onset.onset_strength` with a pitch tracker (CREPE or `librosa.pyin`). If pitch changes but onset strength stays flat, classify as slur. If both change together, detaché.

---

## 5. String Instrument Specific Challenges

### Bowed vs pizzicato detection

Bowed and pizzicato (plucked) notes have *very* different onset envelopes:

- **Bowed:** onset is gradual, spectral spread, sustain is energetic, no sharp release
- **Pizzicato:** sharp transient, fast decay, less sustain energy, narrow spectral peak

In MVP, we assume the entire piece is one or the other (user picks at upload time, or we infer from the score's `pizz.` markings). V2 will try to distinguish per-passage from the audio.

Pizzicato is *easier* for onset detection than bowed (the sharp transient is unambiguous), so a "pizzicato-only mode" is technically the easiest MVP — but it's not the most common use case. We launch with bowed mode first.

### Slur handling

Already covered in §4. Adding here for completeness:

- MVP: trust the score's slur markings (from OCR); skip per-note timing inside slurs; check boundaries.
- V2: detect actual slurs in the recording; flag mismatches between score-marked and played slurs.
- V3: full bow-stroke segmentation.

### Low-register double bass issues

The double bass low register (E1 = 41 Hz to ~G2 = 98 Hz) creates several signal-processing headaches:

1. **Low onset clarity.** Bass notes have slow attack envelopes; the onset "peak" is broad rather than sharp. librosa's default onset detector is tuned for treble. Mitigation: apply a high-pass-then-bandpass filter before onset detection, OR use `librosa.onset.onset_detect` with a much lower `delta`. May need to detect onsets in the *high partials* of the note rather than the fundamental.
2. **Mic frequency response.** Phone mics roll off below ~80 Hz. The low E (41 Hz) is barely captured. Mitigation: rely on the 2nd partial (82 Hz, audible) for onset cues; don't depend on fundamental.
3. **Room acoustics.** Bass low notes excite room modes; a 50ms reverb tail can fake an onset. Mitigation: pre-emphasis filter before onset detection; reject onsets with implausibly short inter-onset intervals (<60ms).
4. **String resonance / sympathetic vibration.** Open strings ring out under stopped notes. Mitigation: again, threshold tuning. Real-world recordings will tell us how much this matters.

Practical approach: **build with treble strings first** (cleaner signal), validate the pipeline, then tune for double bass. The architecture is shared; only threshold values change.

### Vibrato noise

Wide vibrato can register as multiple onsets to a naive detector (each cycle of vibrato has a small amplitude peak). Mitigation:
- Reject onsets within 80ms of each other (no real note-changes that fast in MVP repertoire)
- Use spectral flux (rate of change in spectral energy) instead of pure amplitude flux for onset detection — vibrato is a pitch wobble, not a spectral discontinuity, so spectral flux is robust to it
- librosa's `onset.onset_strength` with `feature=librosa.feature.melspectrogram` (default) is reasonably vibrato-tolerant

### Sul tasto / sul ponticello timbre variation

Standard playing (ordinario) vs sul tasto (over the fingerboard, mellower, less harmonics) vs sul ponticello (near the bridge, harsher, more high partials) produce very different timbres but the *onset* pattern is essentially the same in all three. Onset detection is tonally agnostic if we use spectral-flux-based detection (which we are). So this is **not a problem for MVP timing analysis**. It would matter for V3 dynamics/articulation analysis.

### Bowing techniques supported in MVP

| Technique | MVP? | Notes |
|---|---|---|
| Détaché (separate bows, even sound) | ✅ | The default; cleanest case |
| Legato (slurred) | ✅ (with score markings) | Special-case logic in §4 |
| Staccato | ✅ | Sharp onsets, shorter notes; works fine with same pipeline |
| Spiccato (off-string bouncing) | ✅ | Onsets are even cleaner than détaché |
| Pizzicato | ⚠️ V1.1 | Different onset envelope; works but worth its own threshold tuning |
| Tremolo | ❌ V2+ | Many onsets per beat; needs special handling — possibly skip timing analysis on tremolo passages |
| Col legno | ❌ V3 | Rare; specialty technique |
| Sul ponticello / sul tasto | ✅ (timbre, not technique) | No special handling needed for timing |
| Glissando / portamento | ❌ V3 | Pitch slides; timing detection would still work but slur handling needed |

---

## 6. Sheet Music OCR Pipeline

### High-level flow

1. User takes photo (or uploads existing image)
2. Client-side: perspective correction, deskew, contrast normalization (use `react-native-vision-camera` + `react-native-image-resizer`)
3. Upload to backend
4. Backend calls Claude Vision API with structured prompt
5. Parse response into internal score schema
6. Return to client for user confirmation
7. User edits any errors
8. Save to database

### The Claude API call

We use `claude-opus-4-7` for difficult / handwritten music, `claude-sonnet-4-6` for standard printed music (cost optimization). The model is selected by an initial cheap classifier call ("is this handwritten or printed?") OR by user toggle.

```python
import anthropic
import base64

client = anthropic.Anthropic()

with open(image_path, "rb") as f:
    image_data = base64.standard_b64encode(f.read()).decode("utf-8")

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=4000,
    messages=[{
        "role": "user",
        "content": [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": image_data
                }
            },
            {
                "type": "text",
                "text": OCR_PROMPT  # see below
            }
        ]
    }]
)
```

### The OCR prompt

```text
You are reading a single line of sheet music for a string instrument. Output a JSON object with this exact schema:

{
  "time_signature": "4/4",
  "key_signature": "D major",
  "tempo_marking": "Allegro" | null,
  "bpm_hint": 120 | null,
  "clef": "bass" | "treble" | "alto" | "tenor",
  "measures": [
    {
      "measure_number": 1,
      "notes": [
        {
          "pitch": "D3" | "rest",
          "duration": "quarter" | "eighth" | "half" | "sixteenth" | "dotted_quarter" | ...,
          "articulation": "staccato" | "tenuto" | "accent" | null,
          "tied_to_next": false,
          "dynamics": "f" | "p" | "mf" | null
        }
      ],
      "slurs": [
        {"start_note_index": 0, "end_note_index": 3}
      ]
    }
  ],
  "repeats": [
    {"start_measure": 1, "end_measure": 8, "type": "repeat" | "first_ending" | "second_ending"}
  ],
  "ocr_confidence": 0.0 to 1.0,
  "notes_to_human": "Any uncertainties — list specific measures or symbols you're unsure about."
}

Rules:
- If you can't read a measure clearly, include it but set ocr_confidence to <0.7 and explain in notes_to_human.
- Do NOT invent notes. If part of the image is illegible, leave that measure empty and flag it.
- Tempo marking: if the score says "Allegro" without a BPM, infer the conventional range and put it in bpm_hint (Allegro ~120, Andante ~76, etc.)
- Slurs: indicate by note index within the measure, 0-indexed.
- Output ONLY the JSON object, no preamble or markdown fences.
```

### Edge cases

**Handwritten music.** Claude Opus handles handwritten reasonably well but accuracy drops from ~95% on printed to ~70–80% on handwritten. We surface low confidence and rely on user correction. Don't promise handwriting works perfectly in marketing.

**Multi-line / multi-page.** MVP: one line at a time. User photographs each line separately. V2: page-level capture with line segmentation pre-processing (use OpenCV to find staff lines and crop into individual systems).

**Complex notation.** Tuplets (triplets, quintuplets), grace notes, ornaments (trill, turn, mordent), accidentals across measures, key changes mid-piece. Most are recognizable to Claude but error-prone. We flag and let user correct.

**Repeats.** First/second endings, D.C., D.S., coda. We extract these but also let the user "linearize" the score before recording (i.e. say "I'm playing through with all repeats" or "skipping the repeat").

**Cut-off measures at edges.** Common when shooting a phone photo; user thinks they got the whole line. We detect (last measure has unusual note count or no barline) and prompt user to re-shoot or trim.

**Score with multiple voices / chords.** Bass occasionally has double stops; violin frequently. MVP treats double stops as a single event at the lower note's pitch (since onset is what we care about, not pitch). V2: full polyphonic handling.

**Lighting / shadow / page curl.** Pre-process: client-side perspective correction + brightness normalization. If the OCR confidence comes back too low, prompt for a re-shoot before sending the audio.

### Performance + cost

- Average image: 600KB JPEG after compression
- Claude Sonnet 4.6 cost: ~$0.05 per OCR call at typical image sizes
- Latency: 3–8 seconds per OCR
- Cache: same score image hash → cached parse, no second API call

### Score JSON validation

We schema-validate the Claude response with Pydantic. If it fails (Claude returned malformed JSON or invalid enum values), we re-prompt with the error message attached. After 2 retries, surface the failure to the user with "We had trouble reading this score; please retry the photo."

---

## 7. Score-Audio Alignment (Dynamic Time Warping)

### Reading order before you write code

1. **`librosa.sequence.dtw` documentation** — start here. The API is what you'll actually call; the docstring shows the relevant arguments (`metric`, `subseq`, `step_sizes_sigma`, `weights_add`) and a complete usage example.
2. **`librosa.onset.onset_detect` documentation** — same; the parameter glossary (`pre_max`, `post_max`, `delta`, `wait`) is what you'll be tuning all month.
3. **Bryan Pardo, "Score-Audio Alignment Using DTW" (2008)** — theoretical background. Read after you have something running and want to understand failure modes.
4. **Müller, "Fundamentals of Music Processing" Ch. 3 (DTW) and Ch. 6 (Music Synchronization)** — best textbook treatment if you need depth. Free PDF on the author's site.

The docs unblock you in a day; the papers tell you what's deep about the problem when something doesn't work.

### Why DTW

The straightforward approach — assume the user plays exactly N notes at exactly the score's expected times — fails the moment they:
- Skip a note
- Add an extra note (mistake)
- Pause to re-take a passage
- Have a rest count miscalculation

Dynamic Time Warping is a classic algorithm for aligning two sequences that have similar shape but different timing. It's the standard tool for score-following systems in MIR (music information retrieval).

### How it works (in our application)

We have two sequences:
- **Expected onsets** (from the score, scaled to target BPM): a list of timestamps where notes *should* occur
- **Detected onsets** (from the audio): a list of timestamps where notes *actually* occurred

DTW computes a cost matrix between these two and finds the lowest-cost alignment path. Each detected onset gets matched to one expected onset (or to a "skip" / "extra note" state).

Output: a mapping from `detected_onset_idx` → `expected_onset_idx`, plus the cost of the alignment.

### Implementation

```python
import librosa
import numpy as np

# Detected onsets (from librosa)
onset_frames = librosa.onset.onset_detect(y=audio, sr=sr, units="time")

# Expected onsets from score JSON, scaled to target BPM
expected_onsets = compute_expected_onsets(score_json, target_bpm)

# DTW
D, wp = librosa.sequence.dtw(
    X=onset_frames.reshape(-1, 1),
    Y=expected_onsets.reshape(-1, 1),
    metric="euclidean",
    subseq=False  # we want a full alignment, not a subsequence match
)

# wp is the warping path: list of (detected_idx, expected_idx) pairs
# in reverse chronological order
```

### Handling mistakes and missed notes (fuzzy matching)

DTW alone doesn't handle the case where the student played 27 notes when the score has 30, or vice versa. We add fuzzy logic on top:

- **Many-to-one matches.** If two consecutive detected onsets both align to the same expected onset, the second one is treated as either (a) a re-attack/false trigger we should ignore, or (b) an extra note the player added. Use the inter-onset gap and pitch (V2) to decide.
- **One-to-many.** If two consecutive expected onsets both align to the same detected onset, the player skipped one. Flag as a "missed note" but don't disrupt the alignment going forward.
- **Cost ceiling.** If the alignment cost exceeds a per-note threshold (player drifted too far from the score), the alignment is "broken." We restart alignment from the next clear onset and report a "lost alignment" warning.

### When alignment breaks down

Realistic failure modes:

1. **Student played a totally different passage** by accident (wrong page). DTW cost goes through the roof; we detect this within a few notes and abort with a clean error.
2. **Long stop or silence mid-piece** (student paused). We detect a >2-second gap with no onsets; treat as a soft restart point and align the audio after the gap to the next score location.
3. **Score had a repeat the student didn't take** (or vice versa). Mid-piece misalignment; we try to re-align after each major mismatch. If we lose alignment more than 3 times, report partial analysis.
4. **Pizzicato note registered as multiple onsets** (string ring). Pre-filter: minimum 60ms inter-onset gap.

### Reporting alignment quality

The analysis result includes an `alignment_quality` score from 0–1. <0.7 → we display a warning ("we had trouble matching your recording to the score; results may be inaccurate"). <0.4 → we don't show the analysis at all; we ask the user to re-record.

---

## 7.5 Accuracy Mitigations & Failure Modes

### Why this section exists

The base pipeline (librosa onset detection → DTW alignment → tolerance-band classification) is directionally correct but has known weak spots. This section documents the five biggest accuracy problems and the concrete mitigations we'll ship to address each one. The honest framing for users is *the app is a useful practice mirror, not an oracle* — the goal of these mitigations is to make the app correctly identify when it doesn't know, not to claim perfect accuracy.

Realistic accuracy target with all mitigations in place: ~92–95% agreement with a teacher's ear on clear-cut cases (rushing/dragging by 10%+ over a passage), ~75–80% on subtle cases (3–5% drift), and a high rate of correctly flagging "couldn't analyze this section" rather than guessing in low-confidence regions.

### Problem 1: Slurred and legato passages

**Why it fails.** `librosa.onset.onset_detect` defaults to spectral flux, which fires on energy increases. Slurred bowing on bass has soft, gradual attacks — energy rises slowly and the detector either misses notes inside the slur or fires late. Result: the app reports phantom "dragging" because the second note in a slur looks 60ms behind where it should be.

**Mitigation: stacked detector with pitch-change fallback.**

Run three onset functions in parallel and combine via consensus:

```python
import librosa

# Three detectors with different sensitivities to attack character
flux_onsets = librosa.onset.onset_detect(
    y=audio, sr=sr, units="time", onset_envelope=librosa.onset.onset_strength(y=audio, sr=sr)
)
complex_onsets = librosa.onset.onset_detect(
    y=audio, sr=sr, units="time",
    onset_envelope=librosa.onset.onset_strength(y=audio, sr=sr, feature=librosa.feature.spectral_flux)
)

# Pitch-based onset detection: a pitch change inside a slur is still a note boundary
# even if energy didn't spike
f0, voiced_flag, voiced_prob = librosa.pyin(audio, fmin=40, fmax=400, sr=sr)
pitch_change_onsets = detect_pitch_transitions(f0, min_semitone_change=0.5)

# Consensus: keep onsets where at least 2 of 3 detectors agree (within 30ms window)
# OR pitch_change alone fires (since slurs may have no energy onset at all)
onsets = consensus_merge(flux_onsets, complex_onsets, pitch_change_onsets, window_ms=30)
```

**Score-aware refinement.** When the score says "8 notes in this measure" but the detector found 4, search the audio in that measure with a relaxed onset threshold (lower `delta`, smaller `wait`) and use pitch contour to find sub-onsets. The score acts as a prior on how many onsets to expect.

**Bass-specific filter.** Apply a low-frequency emphasis filter (boost 80–300 Hz, the fundamental + first overtone of double bass) before onset detection. Default librosa onset detection is biased toward higher frequencies where attack transients are clearer; that bias hurts us on bass.

### Problem 2: Sub-5% drift vs musical rubato

**Why it fails.** Humans intentionally play with micro-rubato for musicality. A teacher hearing a player consistently 3% behind the metronome would call it "their natural feel," not dragging. Our default ±5% tolerance band is generous, but anything we report inside that band risks being noise.

**Mitigation: confidence bands + personal baseline.**

In the verdict UI, replace the binary green/red with three states:

- **Green ("on tempo"):** within ±5% of target *and* within ±3% of user's personal baseline for this piece.
- **Yellow ("trending fast/slow"):** outside ±5% but inside ±10%, *or* a sustained drift in one direction over 8+ notes.
- **Red ("rushing/dragging"):** outside ±10%.
- **Gray ("within tolerance, no verdict"):** anywhere inside ±3% — we don't claim certainty here.

**Personal baseline.** After a user's first 10 sessions on a given piece, compute their natural rubato pattern (which beats they consistently sit slightly behind, which they push). Store as `pieces.user_baseline_profile` (JSONB). Subsequent verdicts compare against the baseline-adjusted target, not the raw metronome target. A user who's consistently 3% behind isn't dragging — that's their groove and we should learn it.

**Phrase-level vs beat-level.** Rushing *through* a phrase is musical (typical for crescendos and ascending lines); rushing *within* a phrase to get to the end is a problem. The analysis pipeline computes both:
- `beat_level_drift`: per-note timing error (raw)
- `phrase_level_drift`: net drift across each phrase (computed against score-marked phrase boundaries from OCR)

The default UI shows phrase-level. Beat-level is available on tap.

### Problem 3: DTW misalignment cascading into garbage

**Why it fails.** When alignment goes wrong (player skips a measure, or OCR misreads a rhythm), DTW can lock onto the wrong correspondence and the rest of the analysis is nonsense. Worse: the user has no way to know — the app shows confident verdicts on garbage data.

**Mitigation: three layers.**

**(a) Constrained DTW.** Use a Sakoe-Chiba band to limit how far DTW can deviate from the diagonal. A band of ±20% of the total path length prevents wild excursions:

```python
D, wp = librosa.sequence.dtw(
    X=detected_features,
    Y=expected_features,
    metric="cosine",
    subseq=False,
    band_rad=0.2,  # Sakoe-Chiba band — ±20% of path length
)
```

**(b) Per-cell confidence.** For each step in the warping path, compute a local confidence score based on local cost vs. neighborhood cost. When confidence drops below 0.4 for a contiguous span of 4+ notes, flag that span as "couldn't analyze" in the UI rather than reporting a verdict.

**(c) Skip detection and resync.** If alignment cost spikes for >2 seconds, attempt a resync at the next clear landmark — downbeat, rest, repeat sign, dynamic marking (anything OCR extracted as a structural feature). The pipeline restarts DTW from that landmark forward, marks the unaligned span as "skipped," and continues. Better to lose a measure than to corrupt the rest of the analysis.

**(d) Chroma features alongside onsets.** Onset-only DTW is brittle on legato. Add chroma features (12-dim pitch class profile per frame) as a second alignment signal. Chroma is robust to timbre changes and tells DTW "the pitch content here matches measure 14, even if onsets are ambiguous." Use a weighted combination: 0.6 onset cost + 0.4 chroma cost.

### Problem 4: Room acoustics

**Why it fails.** Reverberant rooms smear onsets — the reflection of a note arrives 80–200ms after the direct sound and can register as a phantom onset. Bedrooms with curtains and beds are fine; tile bathrooms, large practice rooms, and empty halls are not.

**Mitigation: acoustic profiling during calibration + adaptive thresholds.**

The 2-second calibration clip already exists for tempo. Extend it to also capture room characteristics:

```python
def analyze_calibration_acoustics(calibration_audio, sr):
    # Estimate RT60 (reverb decay time) from the trailing silence after each note
    rt60 = estimate_rt60_schroeder(calibration_audio, sr)

    # Estimate noise floor (background noise level)
    noise_floor_db = compute_noise_floor(calibration_audio, sr)

    # Estimate signal-to-noise ratio
    snr_db = estimate_snr(calibration_audio, sr)

    # Detect clipping
    clipping_pct = (np.abs(calibration_audio) > 0.99).sum() / len(calibration_audio)

    return {
        "rt60_seconds": rt60,
        "noise_floor_db": noise_floor_db,
        "snr_db": snr_db,
        "clipping_pct": clipping_pct,
    }
```

**Threshold adaptation.** Pass the acoustic profile to onset detection. Reverberant rooms (RT60 > 0.6s) get tighter `pre_max` / `post_max` peak-picking parameters and a higher `wait` threshold (60ms → 100ms inter-onset minimum) to suppress reflection-induced phantom onsets.

**Spectral whitening.** Apply spectral whitening to flatten room coloration before onset detection. This removes consistent frequency emphasis that reverb adds.

**Refuse-to-analyze gate.** If calibration shows any of:
- RT60 > 1.2s (church-level reverb)
- SNR < 15dB (too noisy)
- Clipping > 0.5% (mic overload)

…abort calibration with a specific message: *"Your room has a lot of echo — try moving closer to a curtain or carpet, or close the door of a smaller room."* Don't analyze badly and give the user wrong feedback.

### Problem 5: Per-note verdicts vs trend reporting

**Why it fails.** Showing a wall of per-note green/red verdicts implies certainty we don't have, and overwhelms the user with noise from the inevitable false positives. Users lose trust when they see a confidently-red verdict on a note they're sure they played correctly.

**Mitigation: phrase-first UI, drill-down on tap, gray-out low-confidence.**

**Default view.** A trend line per phrase, with a confidence band. The chart shows the user's drift across the phrase as a smoothed line, with a shaded ±confidence range around it. Phrases color overall: green (within tolerance), yellow (drifting), red (problematic).

**Drill-down.** Tap a phrase → expand to per-note view. Per-note verdicts are shown only inside this expanded state, and any beat with confidence < 0.5 renders as a gray dot rather than a colored verdict. The user sees explicitly *we're not sure here* instead of a guessed answer.

**Aggregate sparingly.** The "single per-piece tempo verdict" stays — that's the headline number — but it's computed from the trend, not from a count of per-note verdicts. A piece that's 10% red beats but 90% green beats with a flat trend should be "on tempo with a few stumbles," not "rushing."

### Architecture: hybrid analysis pipeline

For the cases where the librosa-only pipeline yields low confidence, fall back to a multimodal LLM for a second opinion. This costs more per analysis but only triggers on the genuinely hard cases.

```
┌──────────────────────┐
│ librosa primary pass │  (cheap, ~2s on Celery worker)
└──────────┬───────────┘
           │
           ▼
   ┌───────────────┐
   │ Confidence    │
   │ check         │
   └───┬───────┬───┘
       │       │
   high│       │low (< 0.6 alignment quality
       │       │     or > 30% gray notes)
       │       │
       ▼       ▼
   ┌────────┐  ┌──────────────────────┐
   │ Return │  │ LLM second-opinion   │
   │ result │  │ (Gemini 2.0 audio    │
   └────────┘  │  or claude-opus-4-7) │
               │ + score region       │
               │ → returns refined    │
               │   onsets + verdicts  │
               └──────────────────────┘
```

**When it triggers.**
- `alignment_quality` < 0.6, OR
- > 30% of notes flagged low-confidence, OR
- A specific user-flagged section ("analyze this measure again")

**Cost projection.** ~10–15% of analyses trigger the second pass. At ~$0.04 per analysis for the multimodal call, on 10K monthly analyses that's $40–60/mo extra inference cost. Worth it — these are the cases where the user loses trust if we get it wrong.

**Implementation note.** The LLM second-opinion path is a separate Celery task. Don't block the primary response on it; return the librosa result with a "refining…" status, then update the result via WebSocket / polling when the LLM call completes (typically 8–15s).

### Architecture: user feedback loop

The biggest accuracy lever over time is labeled data from real users. Ship a feedback mechanism from day one.

**On every verdict, a "this was wrong" button.** Tapping it opens a quick form:
- *Was the beat actually:* on tempo / rushing / dragging / I don't remember
- *Optional:* short text comment

Store as `verdict_corrections` (verdict_id, user_id, user_label, comment, created_at).

**What we do with it.**
- **First 1K corrections:** manual review by us (or contracted teacher) to validate the user's correction is itself correct. Many users will mark verdicts wrong because they disagree with the *concept*, not because the algorithm misfired.
- **First 10K validated corrections:** retrain onset detection thresholds and tolerance bands per-user. Build a per-user `accuracy_profile` that adjusts pipeline parameters.
- **At scale (100K+ corrections across the user base):** train a small bass-specific onset detection model (transfer-learn from a generic CREPE checkpoint) that beats librosa defaults significantly on bass-specific repertoire.

This is the moat. The academic algorithms are public; labeled bass + cello + viola + violin onset data isn't. Three years of user corrections is a defensible dataset that no competitor without users can match.

### What we explicitly don't try to fix in v1

- **Vibrato confounding pitch tracking.** Heavy vibrato can confuse pyin's pitch estimates. Mitigation is post-v1; for now, the pitch-change onset detector is a fallback, not primary, so this only hurts in slur-heavy passages with heavy vibrato.
- **Multi-instrument recordings.** If the user records themselves playing along with a duo partner, the analysis is undefined. We'll detect this (2+ pitch streams) and refuse to analyze.
- **Genre-specific timing conventions.** Jazz and Baroque have very different "on-tempo" expectations. v1 treats classical as the default; explicit genre tagging is post-launch.

---

## 8. Monetization Strategy

### Tier structure

#### Free
- 3 analyses per calendar month
- No saved history (analyses available for 24 hours then expire)
- Web only (no native app for free users — drives App Store ratings via paid users)
- "Powered by InTempo" watermark on shared screenshots
- Includes core features so users feel the product

#### Pro — $7.99/month or $59/year
- Unlimited analyses
- Saved history (full retention)
- Comparison view (today vs last attempt)
- Native iOS + Android apps
- Tempo trend chart
- Export results as PDF
- Priority OCR (Opus instead of Sonnet)
- No watermarks

Annual price ($59) is a 38% discount on monthly — meaningful but not desperate. Most students will pick monthly first; annual is the upsell after 2 months of usage.

#### Teacher — $19.99/month per studio (up to 25 students)
- All Pro features for teacher account
- Pro features extended to all 25 student seats
- **Studio dashboard:** view all assigned students' recent analyses, see who's practiced, see who's improving
- **Assignment builder:** assign a piece + tempo target + due date to a student
- **Teacher comments** on student analyses
- $19.99/mo for 25 seats = $0.80/seat/month — a fraction of the per-student Pro price, intentionally to make this a no-brainer for teachers
- Annual: $199 (17% discount)

### Pricing rationale

- $7.99 sits below Spotify ($11.99), Tonara ($10/mo), Trala ($15/mo) — undercuts incumbents but isn't bargain-bin
- Teacher tier at $19.99 is impulse-purchase territory for a teacher with even 5 students; a teacher with 20 students is paying $1/seat — unbeatable on per-seat economics
- Educational discount available on request (50%) for confirmed students/teachers with .edu emails

### App Store 30% cut math

iOS: Apple takes 30% of all in-app subscriptions in year 1, drops to 15% in year 2 (subscription-specific).
Android (Play Store): 15% on all subscriptions from $0–$1M/year.

| Tier | Sticker price | iOS net (Y1) | iOS net (Y2+) | Android net | Stripe (web) net |
|---|---|---|---|---|---|
| Pro monthly | $7.99 | $5.59 | $6.79 | $6.79 | $7.50 (after Stripe 2.9%+0.30) |
| Pro annual | $59 | $41.30 | $50.15 | $50.15 | $57.00 |
| Teacher monthly | $19.99 | $13.99 | $16.99 | $16.99 | $19.30 |
| Teacher annual | $199 | $139.30 | $169.15 | $169.15 | $193.00 |

Web checkout (via Stripe) is the highest-margin channel — push users there when possible (post-trial email, "save 6%" framing).

### MRR projections

Conservative assumptions: 80% on iOS (Apple cut applies), 5% conversion from free to paid, 40% of paid choose annual (counted as monthly equivalent).

| Total users | Free (95%) | Paid (5%) | Pro $7.99 net | Annual mix | Effective MRR |
|---|---|---|---|---|---|
| **100** | 95 | 5 | $5.59/user | 2 monthly + 3 annual | ~$25/mo |
| **500** | 475 | 25 | | 15 monthly + 10 annual | ~$120/mo |
| **1,000** | 950 | 50 | | 30 monthly + 20 annual | ~$240/mo |
| **5,000** | 4,750 | 250 | | 150 monthly + 100 annual | ~$1,200/mo |
| **10,000** | 9,500 | 500 | | 300 monthly + 200 annual | ~$2,400/mo |

Plus teacher tier — a single teacher subscription at $19.99 nets ~$14 after Apple cut; if 1 in every 50 active users is a teacher and converts, that adds substantial MRR with very low marginal cost.

**Realistic break-even:** 600–800 paying users covers infra + Claude API costs ($300–500/mo). Beyond that, every paying user is contribution margin. Solo developer should aim for 2,000 paid users (~$5,000 MRR) before adding salary considerations.

### CAC strategy

- **Organic via teachers:** $0 CAC if teachers refer their students. Teacher tier is the wedge.
- **Paid:** test Reddit ads on r/cello, r/violin, r/Bass; Instagram/TikTok creators in the music education space ($500–1,500 per integration)
- **App Store search ads:** later, after we have screenshots that convert
- **Content:** YouTube videos demonstrating the analysis on famous performances ("did Hilary Hahn rush this passage?") — viral potential, costs only time

### Churn assumptions

Subscription music apps in the practice/education space see 7–12% monthly churn. Annual subscriptions churn ~30% at renewal. Build the product with this in mind — saved history, streak metrics, teacher integration — to hit closer to 7%.

---

## 9. Go-To-Market Plan

### Sequencing: web → iOS → (validate) → Android

**Explicit decision: iOS-first on native. Android is gated on iOS validation.**

A solo developer shipping iOS + Android simultaneously doubles testing surface, App Store accounts to manage, audio API quirks to handle, and review cycles to coordinate. Pick one mobile OS first, validate that the product works, then port.

**Why iOS first** (after web):
1. **Music education skews iOS.** US private music students and teachers over-index on iOS. Higher willingness to pay; tighter community on Apple devices (parents who can afford private music lessons more often have iPhones).
2. **Apple's subscription / IAP tooling is more mature** than Play Store's, especially around free trials and family sharing.
3. **TestFlight is excellent** for beta cycles — better than Play Store internal testing.
4. **Audio recording API consistency.** AVAudioRecorder on iOS is more uniform than the fragmented Android audio stack (different OEMs do audio differently).
5. **Less device-fragmentation testing** — 5 active iPhone models cover ~80% of users; Android needs you to test against half a dozen popular OEMs at minimum.

**The Android gate:** ship Android only after (a) iOS hits a clean monthly retention number (40%+ at month 1) and (b) we have ≥500 paying iOS subscribers. That's the signal that the product works; before then, Android is a distraction.

**Android timing:** Once Android is greenlit, it's a 4–6 week port (RN code carries over; the work is mostly testing on real devices and handling Android-specific audio recording quirks).

**Why web first overall.** Three reasons:
1. **Iteration speed.** Push fixes hourly. App Store reviews take 1–3 days each.
2. **No 30% Apple cut on early revenue.** Stripe direct.
3. **Easier user research.** Show real users a live URL; debug their environment over a screenshare.

The web app will be a React app sharing 90%+ of its components with the React Native build (use `react-native-web`). When iOS lands, code reuse is high.

**Targets:** Web app weeks 1–8. iOS app weeks 9–15. Android port: gated, but if greenlit, weeks 19–24.

### Target communities (in priority order for first 100 users)

1. **r/cello, r/violinist, r/Bass** — Reddit communities with engaged amateur and student musicians. Post a "I built this — would love feedback" thread. ~5,000–20,000 members each.
2. **YouTube musician channels.** TwoSet Violin, Hilary Hahn channels, Adam Neely (analytical). DM creators with a free Pro code; ask for a 30-second demo if they like it.
3. **Music school Discord / Slack groups.** Most conservatories have student Discords; asking the orchestra librarian or student council to share is high-trust low-cost.
4. **Private teachers (direct outreach).** Email 100 string teachers with a 2-paragraph pitch + a video. Convert at 5% = 5 teachers. Each teacher has 10–25 students = 50–125 students who will hear about it from a trusted source.
5. **String instrument forums.** TalkBass, Violinist.com forums. Older users, less viral, but high engagement.
6. **MTNA, ASTA, NAfME conferences (later).** Booth presence at music education conferences is high-cost but legitimizes the product for institutional sales.

### App Store Optimization (ASO)

**Title:** `InTempo: Practice Tempo Coach` (uses "tempo" + "practice" + "coach" — highest-volume keywords for the niche)
**Subtitle:** `Sheet music + audio = better timing`
**Keywords:** practice, metronome, sheet music, tempo, violin, cello, bass, music school, audition, rushing, dragging, MTAC, ASTA
**Screenshots:** Annotated score → trend chart → verdict → upgrade prompt (in that order)
**Preview video:** 30-second flow of photographing music, playing, getting the verdict

**Localization (V2):** Spanish, Mandarin, Japanese, Korean — strong music education markets.

### Pricing experiments

A/B test:
- $7.99 vs $9.99 vs $4.99 — find the elasticity point
- Yearly $59 vs $79 vs $49
- Free trial 7-day vs 14-day vs none
- Free tier limit: 3 vs 5 vs 1 analysis/month

Use Stripe-side flags + feature-gate logic to swap without a release.

### Content marketing

- **YouTube series: "Did they rush?"** — analyze recordings of famous string performances against InTempo. Viral potential; cheap to make.
- **Blog: "How to practice tempo without a metronome"** — SEO targeting "rushing music," "dragging tempo," "practice tempo," "timing in music"
- **Teacher resource page** — downloadable practice templates, free for any teacher who registers (lead gen)

---

## 10. Development Phases & Timeline

Built around a solo founder working ~30 hrs/week. Adjust if multi-person team.

### Phase 1: Foundation (weeks 1–3)

| Week | Deliverable | Notes |
|---|---|---|
| 1 | Project setup, repo structure, FastAPI scaffold, Supabase project, basic CI | No product code yet; just the rails |
| 2 | Audio upload endpoint + S3 / Supabase storage; health checks; auth wired up | Test with curl, no UI yet |
| 3 | Sheet music OCR call working end-to-end with Claude API; schema validation | Test with 10 hand-chosen scores: handwritten, printed, complex, simple |

Milestone: can POST a JPEG of sheet music, get back valid score JSON. Can POST audio, get back filename + size confirmation.

### Phase 2: Audio analysis core (weeks 4–6)

| Week | Deliverable | Notes |
|---|---|---|
| 4 | Onset detection + per-note timestamp output | librosa pipeline; test with 10 recordings |
| 5 | DTW alignment + fuzzy match handling | The hardest week; expect hiccups |
| 6 | Tolerance band classification + rolling-average trend; verdict generator | Returns the full analysis JSON |

Milestone: can submit a (score JSON + audio + target BPM) tuple and get back a full analysis with per-note classification, trend data, and a verdict.

### Phase 3: Web frontend MVP (weeks 7–9)

| Week | Deliverable | Notes |
|---|---|---|
| 7 | React app: auth, score upload + preview, audio recording (browser API) | Mobile-friendly; no native yet |
| 8 | Analysis submit + results view: annotated score + trend chart + verdict | Server-rendered annotated score PNG initially |
| 9 | Free tier limits + Stripe checkout + Pro tier gate | Real payments working |

Milestone: a real user can sign up, photograph score, record audio, see results, and upgrade to Pro. Web app in beta.

### Phase 4: Beta + iteration (weeks 10–12)

| Week | Deliverable | Notes |
|---|---|---|
| 10 | Recruit 10–20 beta users; gather first real recordings; tune thresholds | Real data tells us what defaults to ship |
| 11 | Score editing UI (user corrects OCR errors); calibration clip flow | Two features users will demand once they hit OCR errors |
| 12 | Bugfix + onboarding polish; teacher tier wireframes (deferred build) | Sharpen the core before going native |

Milestone: web app at "would recommend to a friend" quality. ≥30 NPS from beta users.

### Phase 5: Native iOS (weeks 13–15)

| Week | Deliverable | Notes |
|---|---|---|
| 13 | React Native scaffold; share components with web; native camera + audio | EAS Build set up |
| 14 | Apple IAP integration (RevenueCat to abstract Apple's APIs); test with TestFlight | RevenueCat saves weeks |
| 15 | App Store listing assets (screenshots, video, copy); submit for review | First review usually takes 1–3 days |

Milestone: iOS app live on TestFlight; App Store review submitted.

### Phase 6: Launch + acquisition (weeks 16–18)

| Week | Deliverable | Notes |
|---|---|---|
| 16 | App Store launch + initial Reddit / community announcements | Soft launch — feedback before paid acq |
| 17 | First YouTube creator integrations (1–3 paid sponsorships at $500–1500 each) | Aim for 1k installs in 2 weeks |
| 18 | Analytics review, churn cohort, pricing iteration | First data-driven pricing tweak |

Milestone: 1,000 total users, 50 paid subscribers, $250+ MRR.

### Phase 7: Teacher tier (weeks 19–22)

Teacher tier dashboard build, manual onboarding of first 5–10 teachers. The DB schema already supports it (see §2 + §3); this phase is the UI + reviewer flow + assignment creation + studio dashboard.

### Phase 8: Android — gated (weeks 23–28, only if greenlit)

Android port runs only if iOS hits the gate: 40%+ M1 retention, 500+ paying subscribers. Otherwise this slot is used to deepen iOS (better OCR, V2 features). The decision happens around week 22 based on cohort data.

If greenlit:
- Weeks 23–24: RN Android build, audio API testing across 6+ device models (Pixel, Samsung Galaxy, OnePlus, Xiaomi, etc.)
- Week 25: Play Store assets and submission
- Weeks 26–28: launch + paid acquisition cycle on Android

### Phase 9: V2 build (weeks 29+)

Slur detection, side-by-side comparisons, on-device analysis port (TFLite). Driven by what beta data shows is the most-requested feature.

### Testing milestones

- **Weekly unit tests** on the audio pipeline (10 fixed test recordings, expect specific outputs)
- **End-of-phase E2E tests** simulating full user flow
- **Beta user testing weeks 10–12** with structured feedback form
- **TestFlight cohort** (50 invited users) for week 14
- **Pre-launch private beta** (200 users) week 15

---

## 11. Tech Stack Decisions

For each major decision, why this over alternatives.

### Native OS sequencing: iOS-first vs Android-first vs both

**Choice: iOS first, Android gated on iOS validation.**

Even though we're using React Native, "shipping iOS" and "shipping Android" are still two separate problems — separate App Store accounts, separate audio API edge cases, separate review processes, separate device-test matrices. A solo developer launching both simultaneously gives both halfway attention.

- **iOS first** because: music education over-indexes on iOS in the US; Apple subscription tooling is more mature; TestFlight is better than Play Internal Testing; less device fragmentation; the audio recording APIs are more consistent.
- **Android gate:** ship Android only after iOS hits 40%+ M1 retention and ≥500 paying subscribers.
- **Why not Android first:** Larger device install base globally, but US music-education monetization is iOS-skewed and that's our beachhead market. Android ports better than de-novo Android builds.
- **Why not both:** doubles solo-dev testing burden; nothing about our tech stack requires shipping both at once.

If a partner / cofounder joins the team, this calculus changes — Android could ship in parallel.

### React Native vs Swift / Kotlin native

**Choice: React Native.**
- **Code reuse with web** (React Native Web) — share components for the marketing-page-to-web-app-to-mobile-app pipeline.
- **One codebase, two stores.** A solo dev can ship iOS + Android in roughly the time it takes to ship just iOS in Swift.
- **Audio recording quality** is good enough in RN's audio APIs for our use case (we're not doing real-time analysis on-device — we ship audio to backend).
- Trade-off: RN startup time and animation feel slightly worse than native. We'll live with it.
- If we discover a hard limit (e.g. RN audio latency too high for live-monitoring features in V3), we rewrite the audio module in native and bridge.

**Why not Swift-only:** Cuts off Android forever, doubles dev time. Would only choose this if we were going premium-iOS-only.

**Why not Flutter:** Smaller string-instrument community among devs; less library ecosystem for our use case; Dart adds friction for hiring.

### Python + FastAPI vs Node + Express vs Go

**Choice: Python + FastAPI.**
- **librosa is Python.** That alone decides it — re-implementing onset detection in another language is a multi-week project.
- **scipy / numpy ecosystem** for audio processing is unmatched.
- **FastAPI** specifically: type hints, async-first, auto-generated OpenAPI docs.
- Trade-off: Python's slower than Go; we mitigate with horizontal scaling + Celery workers.

**Why not Go:** Faster, but we'd lose librosa.

**Why not Node:** Good for I/O-heavy work but the audio analysis libraries are weaker (Meyda is OK but not librosa-grade).

### librosa vs aubio vs Essentia

**Choice: librosa.**
- **Best documented;** widely used in MIR research; most Stack Overflow answers.
- **Onset detection quality** is on par with aubio for our use case.
- **DTW built-in** (`librosa.sequence.dtw`).

**Why not aubio:** Smaller ecosystem; harder to debug; the C bindings sometimes break on Apple Silicon.

**Why not Essentia:** Heavier dep (C++ via Python wrapper); more advanced feature extraction we don't need.

### FastAPI BackgroundTasks vs Celery + Redis (phased)

**Choice: start with `BackgroundTasks`, migrate to Celery on documented triggers.**

Celery + Redis is the right long-term answer for our 5–30 second analysis pipeline, but it's heavy for an MVP — a separate worker process, broker, result backend, dead-letter handling, deployment topology, monitoring, and a category of "task didn't run" debugging that eats sessions. Standing all that up before we know our real latency profile is premature optimization.

**Phase 1 (MVP, Batches 0–4): FastAPI `BackgroundTasks`.**
- Built into FastAPI; no extra deps, no extra processes.
- Returns the HTTP response immediately, then runs the analysis function in the same process after the response is sent.
- Acceptable for our scale at launch: tens to hundreds of analyses per day, single-instance backend.
- Limitations we accept: no retries, no persistence across process crashes (a librosa segfault loses one job), no cross-instance queue when we eventually run multiple backend replicas, and a stuck job ties up an event-loop slot.

Mitigation for the persistence gap: on app startup, sweep `analyses` rows where `status = 'pending'` and `created_at < now() - interval '10 minutes'` and mark them `failed_recoverable` so the user gets a clear "please retry" instead of a forever-spinning UI.

**Phase 2 (migration trigger, typically Batch 5–7 timeframe): Celery + Redis.**

Migrate when *any* of the following becomes true:

- p95 analysis latency > 25s (we're approaching the BackgroundTasks-acceptable ceiling and need workers that can scale horizontally)
- > 200 analyses per day, OR > 5 concurrent analyses regularly
- We deploy a second backend replica (BackgroundTasks doesn't share state across replicas; jobs would run on whichever replica handled the upload, regardless of CPU load)
- Job-loss-from-crashes happens twice in a single week
- We add the LLM second-opinion fallback from §7.5 (those 8–15s extra calls compound the latency profile)

The migration itself is small because we structured the code right from day one: the analysis function is a plain Python function called from a thin task wrapper. In Phase 1 the wrapper is `BackgroundTasks.add_task(analyze, ...)`. In Phase 2 the wrapper becomes `analyze.delay(...)` (a Celery task). Same business logic, same DB writes, same return shape. The migration touches the task wrapper, the API endpoint that enqueues it, and the deployment config — not the algorithm.

**Why not RQ or Dramatiq or arq.**
- **RQ:** simpler than Celery but lacks Celery's chord/group primitives we'll want for the LLM second-opinion fan-out.
- **Dramatiq:** good ergonomics but smaller community; harder to hire for.
- **arq (asyncio-native):** appealing for FastAPI, but our librosa work is CPU-bound and runs better in process workers (Celery prefork) than asyncio workers.

If we hit the trigger and Celery feels heavy, RQ is an acceptable middle-ground for a few weeks — but plan to land on Celery eventually for the production characteristics we'll need at scale.

### Server-side vs on-device audio processing

**Choice: server-side for MVP, on-device for V3.**
- **Server-side benefits:** centralized model updates, easier debugging, one codebase.
- **Server-side costs:** upload latency (3–5 sec for a 30-sec recording on 4G), GDPR considerations for audio in EU.
- **On-device benefits:** instant analysis, offline-capable, privacy-friendly.
- **On-device costs:** CoreML/TFLite porting is complex; harder to update; iOS/Android divergence.

For MVP, server-side wins on simplicity and shippability. V3, port the hot path to on-device once we know exactly what the pipeline looks like and have product-market fit.

### Claude Vision vs custom OMR (Audiveris, OEmer)

**Choice: Claude Vision.**
- **Build vs buy.** Custom OMR is a multi-month effort with no obvious wins over a vision LLM today.
- **Handwriting tolerance.** Claude handles handwritten music far better than rule-based OMR engines.
- **Cost.** $0.05 per OCR call is acceptable; we cache scores.
- Trade-off: dependent on Anthropic's pricing/availability. Mitigation: abstraction layer in the OCR module so we can swap to GPT-4V or a fine-tuned model later.

### Supabase vs Firebase vs custom Postgres + Auth0

**Choice: Supabase.**
- Open-source Postgres (no vendor lock); clean SQL; row-level security; auth + storage + realtime in one product.
- **Less expensive than Firebase** at our scale.
- **Stripe-friendly** (we use Stripe, not Supabase's billing).

**Why not Firebase:** NoSQL (Firestore) makes our analytics/cohort queries painful; vendor lock-in on Google Cloud.

**Why not custom Postgres + Auth0:** Reinventing what Supabase gives for free.

### Stripe vs RevenueCat vs in-house billing

**Choice: Stripe for web, RevenueCat for mobile.**
- **RevenueCat** abstracts Apple IAP + Google Play Billing into one API. Without it, you write the same subscription logic three times. Worth the 1% revenue share.
- **Stripe** for web direct payments, Connect for any future teacher-payout features.

### Sentry / Posthog vs Firebase Analytics

**Choice: Sentry + Posthog.**
- **Sentry** for error tracking; ergonomic and well-priced.
- **Posthog** for product analytics + session recordings; self-hostable later if cost matters.
- **Firebase Analytics** is fine for free but hits walls fast at scale.

---

## 12. Risks & Mitigations

### Technical risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Onset detection accuracy too low on real-world phone recordings (especially double bass) | High | High | Build the pipeline early (week 4–5), test with 30+ real recordings before locking thresholds. Be willing to ship MVP for treble strings only if double bass needs more tuning. |
| DTW alignment breaks down on noisy/incomplete audio | High | Med | Cost-ceiling early-exit; report partial analysis; surface "alignment quality" to user so they know when to discount results. |
| Claude API output is inconsistent JSON | Med | Med | Pydantic validation + 2-retry with error feedback; ultimately fall back to user manual entry. |
| Slur detection unreliable | Med | Low (just for V2) | Defer to V2; MVP requires user-marked slurs from score. |
| Mobile app rejected by Apple for any reason | Med | High | Build to App Store guidelines from day one; don't use private APIs; be careful about subscription disclosure (Apple's "subscription receipt" requirements bite first-time devs). |
| Server-side processing latency over 30 seconds for long recordings | Low | Med | Background workers (Celery) with progress updates; warn users for recordings >3 minutes. |

### Market risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Tonara or SmartMusic adds a tempo-feedback feature first | Med | High | Speed of execution. Niche down (string-specific, audition-prep-specific) so a generalist competitor's feature is shallower than ours. |
| Music students don't want to pay $7.99/month | Med | High | Free tier is generous enough that habit forms before paywall. Teacher tier is the bypass — students get Pro through their teacher's subscription. |
| Teachers refuse to adopt a B2B tool | Med | Med | Direct outreach to 100 teachers; learn their objections; iterate. Teacher tier is the moat — get this right or de-emphasize it. |
| Reddit launch flops | Low | Low | Other channels (YouTube, conferences); not a single-channel bet. |

### Apple App Store risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Rejection for "duplicates existing functionality" | Low | High | Clearly differentiate in app description: this is *not* a metronome. Show analysis screenshots in App Store listing. |
| Rejection for subscription terms not visible enough | Med | Med | Follow Apple's IAP disclosure guidelines verbatim. Show price + auto-renew terms on the upgrade button. |
| Children-safety policies if any users <13 | Low | Med | Require 13+ during signup; have a privacy policy explicit about audio storage. |
| Subscription IAP commission cuts margin | Certain | Med | Pricing built around 30% Apple cut; web checkout offered post-trial as the higher-margin path. |

### Privacy / legal risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Audio recordings of minors stored on backend | Med (most users 12–18) | High | COPPA / privacy policy: parental consent for under-13, audio deleted on request, audio retention defaults to 30 days, no audio used for training without explicit opt-in. |
| Sheet music copyright concerns | Low | Med | We never *display* the sheet music to other users (no public sharing). User uploads are private. We don't sell or republish scores. |
| Score parsing leaks via Claude API | Low | Low | Anthropic's data-usage terms are clear (we don't opt into training); document this for users in the privacy policy. |

---

## 13. Open Questions

These need real-world testing or external data to answer. Don't hard-code assumptions; build the system to be tunable.

### Audio pipeline open questions

1. **What are the exact tolerance band thresholds that feel "right" to musicians?** The 5%/10%/20% bands in §4 are starting values. Real beta data will likely shift them. Build the threshold values as runtime config (not hard-coded constants) so we can A/B test them without redeploying.
2. **Is on-device processing fast enough for the analysis pipeline?** A 60-second recording today takes ~5 seconds on the server. On-device on a midrange phone — could be 15+ seconds, which is a different UX. Test on actual hardware (mid-tier Android, iPhone 12) before committing.
3. **How reliably can we detect slurs from audio alone?** Spectral-flux-based detection is theoretically sound but real-world recordings have a lot of noise (rosin scrape, bow noise, room acoustics). Hard to predict reliability without 50+ recordings to tune against.
4. **Does the double-bass low register actually break onset detection?** Theoretical — the signal-processing concerns in §5 are real, but I don't know yet whether they bite at the level of "MVP unusable" or "MVP fine, V2 polish." Solo founder is a bassist so this gets tested fast.
5. **What's the realistic latency budget?** Total time from "user stops recording" to "user sees analysis": users will tolerate 30 sec for a 4-minute recording, probably not 60 sec. If our pipeline is too slow, we need to either parallelize, optimize, or move parts on-device.

### Product open questions

6. **Will users tolerate the OCR-correction step?** If 30% of the time the user has to fix a measure or two before the analysis can run, that's fine. If it's 80%, the experience is broken. Beta testing tells us.
7. **Will the calibration clip flow feel natural?** In testing, users may forget what tempo they intended; the clip is supposed to bypass that, but they might just play awkwardly. Iterate.
8. **What's the right onboarding sequence?** Should we force the user through a tutorial recording on day 1, or let them try their own piece immediately? A/B test.
9. **Is "rushing" / "dragging" the right vocabulary?** Some students don't know these terms. Maybe "ahead" / "behind" or "fast" / "slow." Subjective; user-test.

### Business open questions

10. **At what price point does conversion peak?** $4.99 vs $7.99 vs $9.99. Tested via A/B during beta.
11. **What's the trial length that maximizes conversion without giving away the product?** 7 days seems reasonable; a 14-day trial converts more but higher refund rate. Test.
12. **How willing are teachers to pay for the teacher tier without seeing student adoption first?** May need a free pilot for the first 10 teachers. Can lifetime-free a few "ambassador" teachers in exchange for testimonials.
13. **What's the right strategy if Tonara / SmartMusic ships a tempo feature?** Build the moat now: be the *string instrument specialist*, integrate deeply with the audition-prep workflow, partner with teachers.

### Strategic open questions

14. **Should we build out wind/brass at V3, or stay deep in strings forever?** Wind has a different onset envelope (gradual attack, breath noise) and a much larger TAM. Strings is a defensible niche; expanding too early dilutes positioning.
15. **Is there a content business here?** Curated audition rep with annotations from professional players (a la "this is how Christopher van Kampen plays the first movement of the Bottesini") could be a bolt-on subscription. Pure content play, very different business.
16. **At what scale does this need a co-founder or first hire?** Solo to ~$10k MRR. Past that, customer support + Android + teacher onboarding becomes too much for one person.

---

## Appendix: Concrete next steps if you're picking this up tomorrow

1. Buy `intempo.app` or pick a final name. Domain availability check before further branding.
2. Set up GitHub repo + Linear (or whatever issue tracker). Start tracking everything in this doc as issues.
3. Spin up Supabase project, FastAPI scaffold, React Native + Web scaffold. Day 1 deliverable: ping-pong API call from native client.
4. Get an Anthropic API key + test the OCR prompt against 10 photographed scores. This tells you immediately how good the OCR layer will feel.
5. Record 10 baseline audio clips (yourself, your teacher, a friend) to use as your fixed test set for the audio pipeline. Same recordings, every threshold tweak — measure regressions.
6. **Read the librosa documentation for `librosa.sequence.dtw` and `librosa.onset.onset_detect` first** — these are the immediately actionable references and the API you'll actually call. Then read Bryan Pardo's "On Score-Audio Alignment Using DTW" (2008) and the librosa onset detection paper for the theoretical background. The docs save you the first week; the papers save you the second.
7. Ship a working backend pipeline before any UI polish. The product is the analysis; everything else is plumbing.

---

*End of document. Update as decisions are made or invalidated.*

---

# Part II — Build Plan

---

## Operating principles

Before any batch:

1. **Fixed test set.** Curate 10 sheet-music photos (handwritten + printed; simple + complex) and 10 audio recordings (clean studio + noisy phone takes; treble + bass). These are your regression suite. Same files every time.
2. **Branch per batch.** `feat/batch-N-description`. Squash to main on DoD.
3. **One fixture file per endpoint.** When you hit a tricky API response, save the raw response to `fixtures/`. Use it in tests forever.
4. **Don't optimize early.** Ship the slowest, ugliest version that works. Iterate in a later batch.
5. **Keep a `DECISIONS.md`.** Every "I picked X over Y because Z" goes in this file. Save your future self the archaeology.
6. **Don't ship `console.log` / `print` debug.** Use a real logger from day one (`pino` for JS, `loguru` for Python).
7. **Smoke-test the happy path manually after each batch.** Automated tests catch regressions; manual tests catch UX wrong-feels.
8. **Record every edit in `EDIT_LOG.md`.** This is the single most important discipline for recovering from "wait, when did this break?" moments. The full spec is in the next subsection — *read it before writing any code*. Without this log, debugging a regression three batches later requires git archaeology that may not even succeed.

---

## Build-time activity logging — what to record, where, and how

This subsection exists because the most expensive failure mode in a multi-week build is *"something used to work and now it doesn't, and I don't know what changed."* The fix is not heroic recall after the fact — it's mechanical logging during the work, so any past state is recoverable in seconds.

If you (Claude, or a developer working with Claude) are picking up this doc to actually build InTempo: **the rules below are not optional polish.** They are how you stay shipping when something breaks at week 8.

### The four logs and what each is for

The repo maintains four separate logs with sharply different scopes. Don't mix them up.

| File | Scope | Frequency | Reader |
|---|---|---|---|
| `EDIT_LOG.md` | Every meaningful change to the codebase, infra, config, or schema | After every edit batch (~5–30 min granularity) | Future-you or future-Claude debugging "what changed since last Tuesday" |
| `DECISIONS.md` | Major "we picked X over Y because Z" architectural choices | Only when a real decision is made (a few times per batch at most) | Anyone joining the project, or future-you forgetting why |
| `TUNING_LOG.md` | Batch 3 audio tuning only — parameter changes with clip-by-clip impact | Every threshold change (see §Batch 3 Tuning Appendix) | Whoever is tuning the audio pipeline |
| Git history | The actual code state at every commit; reversible | Every commit (atomic, frequent) | The mechanical recovery layer underneath all the others |

`EDIT_LOG.md` is the new one and the one Claude must maintain rigorously. The other three already exist in the build plan; this section formalizes the relationship between all four.

### EDIT_LOG.md — required format

Append a new entry to the *top* of the file every time you make a meaningful change. Newest first. The format:

```markdown
## 2026-XX-XX HH:MM — <one-line summary>

**Batch:** <batch number, e.g. "Batch 4">
**Branch:** <git branch name>
**Commit (after this edit):** <git short SHA, filled in after commit>

**What changed:**
- <file path>: <one-line description of what was edited and why>
- <file path>: <...>

**Why:**
<1–3 sentences. The "why" is what makes this useful later. "Refactored to extract helper" is useless; "extracted helper because the same DB query was duplicated in three endpoints and one had drifted" is useful.>

**Tests run:**
- <which test files / fixtures were re-run>
- <pass/fail summary>

**Known side effects / things to watch:**
<Anything you suspect might break later because of this change. If nothing, write "none observed".>

**Rollback:** `git revert <SHA>` reverses this cleanly. <Or note any reason it wouldn't, e.g. "DB migration is destructive — see EDIT_LOG entry from <date> for the down-migration spec.">
```

### What counts as "a meaningful change"

Log it if any of:

- A file was created, deleted, or moved
- A function's signature changed
- A config value was added, removed, or modified (incl. `config.toml`, `.env.example`, `docker-compose.yml`, CI workflows)
- A package was added or removed (`package.json`, `pyproject.toml`)
- A DB schema change (migration created, applied, or rolled back)
- A test was added, removed, or modified
- A threshold or magic number changed in code (cross-reference to `TUNING_LOG.md` if it's a Batch 3 tuning value)
- A dependency version was bumped

Don't log it if it's:

- A pure typo fix (e.g. comment correction, README spelling)
- An auto-formatter reflow that doesn't change semantics
- A whitespace-only change

When in doubt, log. The cost of logging is 30 seconds; the cost of not logging is hours of git archaeology three weeks later.

### How Claude should write entries

**Write the entry as you make the change, not afterwards.** "Afterwards" turns into "tomorrow" turns into "I forgot."

The intended workflow within a single Claude session:

1. Make a small, scoped change to the code (one logical unit).
2. Run the relevant tests; capture pass/fail.
3. Open `EDIT_LOG.md`, prepend a new entry following the format above. Leave the commit SHA blank for now.
4. `git add` + `git commit` with a message that mirrors the entry's one-line summary.
5. Get the new commit's short SHA (`git rev-parse --short HEAD`) and back-fill it into the EDIT_LOG entry. Commit again with `--amend` *only if the EDIT_LOG was the only thing changed*; otherwise commit normally.
6. Move on to the next change.

Yes, this means small commits. That is intentional. Small commits are the unit of revertibility; large commits hide regressions inside them.

### Git discipline that supports the log

The log is only useful if the repo's actual state at any past point is also recoverable. Three rules:

1. **Atomic commits.** Each commit does one logical thing. If you can't write a single-sentence summary, the commit is too big — split it.
2. **Tag the end of every batch.** When a batch hits its Definition of Done, run `git tag batch-N-done` and push the tag. These are your "known good" rollback anchors. Recovering to "the state right after Batch 4 shipped" should be one command: `git checkout batch-4-done`.
3. **Never force-push to `main`.** Force-push on feature branches is fine; on `main` it destroys history that EDIT_LOG entries reference. If you must rewrite history (rare), record it as an EDIT_LOG entry of its own.

### How to use the log when something breaks

The recovery procedure when "X used to work, now it doesn't":

1. Read the most recent ~20 entries in `EDIT_LOG.md`. Look for anything touching the broken area.
2. Found a candidate? Run `git diff <candidate-SHA>~ <candidate-SHA> -- <broken file>` to see the exact change.
3. Confirm it's the cause: `git checkout <candidate-SHA>~` and verify the bug doesn't reproduce; `git checkout <candidate-SHA>` and verify it does.
4. If confirmed, either `git revert <SHA>` (preserves history) or fix forward (preferred if the original change was needed but flawed).
5. Append a new EDIT_LOG entry documenting the diagnosis and the fix.

If the log doesn't reveal the cause within 15 minutes of reading, fall through to `git bisect`. The log narrows the search; bisect mechanically finds the breaking commit when narration fails.

### What "in case something goes wrong" actually looks like

Concrete failure modes the log defends against:

- **A threshold change in Batch 6 silently regresses Batch 3's audio output.** Without the log: hours of confusion. With the log: grep for the threshold name, find the entry, revert.
- **The DB migration in Batch 7 breaks an endpoint added in Batch 5.** Without: read every migration file and pray. With: the log entry for Batch 7's migration says "renamed `user_id` to `account_id` — affects analyses, scores, calibrations endpoints." Search those endpoints, fix.
- **A dependency bump in Batch 11 breaks the iOS bundle.** Without: re-run the whole CI matrix to bisect. With: the bump is logged with the version diff and the rollback command.
- **A Claude session in Batch 9 confidently rewrites a working component because it didn't realize the component was already done.** Without: the rewrite ships and the bug only surfaces after launch. With: the new session reads the log, sees "Batch 7: shipped recording flow component, working on iOS and web" and knows not to touch it.

The fourth one is the most important for Claude-driven development specifically. Across sessions, Claude has no memory. The EDIT_LOG is the memory. Write it like you're leaving notes for a stranger — because you are.

### Initial setup (do this in Batch 0)

In Batch 0, alongside the rest of the foundations, create:

```
EDIT_LOG.md          # starts empty except for a header
DECISIONS.md         # starts empty except for a header
TUNING_LOG.md        # created in Batch 3, but stub it out now with a header
```

The header for `EDIT_LOG.md`:

```markdown
# InTempo Edit Log

Newest entries at the top. Format spec: see "Build-time activity logging" in
intempo-combined.md (or intempo-build-plan.md). Every meaningful change goes
here — see that section for what counts as "meaningful."
```

That's it. The discipline is in the maintenance, not the structure.

---

## Session structure (Claude / Cowork / Dispatch)

Each batch is designed to map onto a Claude work session. With **Cowork + Dispatch** mode, an orchestrator session can spawn focused sub-task sessions per batch (or per sub-component for the iterative ones), pass artifacts between them via files, and hand off to you for the human-in-the-loop work.

### Start of every session

1. Read `intempo-project-plan.md` + `intempo-build-plan.md` (the relevant batch only) + `DECISIONS.md` — in that order.
2. Read code files on demand, not in bulk. Don't load the whole repo into context "just in case."
3. State the session's goal in one sentence at the top: "Today I'm finishing the DTW alignment in Batch 3."
4. Work the batch's Definition of Done as a checklist; tick items as they're done.

### End of every session

1. Update `DECISIONS.md` with anything non-obvious you decided ("picked `librosa.onset.delta=0.07` because at 0.10 we missed soft pizzicato attacks; tested against fixtures 04, 07, 09").
2. Update the build plan's Definition of Done if scope shifted.
3. Commit with a clean message. Squash to main only on full-batch DoD.

### Mapping batches to session counts

Most batches fit one focused session. Three categories don't:

| Batch | Session model | Why |
|---|---|---|
| 0, 1, 2, 5, 6, 7, 8, 10, 11, 13 | One session each | Cohesive scope, well-defined DoD, predictable surface area. |
| **3, 12** | Multi-session via Dispatch | Iterative tuning + multiple sub-flows. Spawn sub-task sessions per component (onset detection → DTW → classification → verdict generator for Batch 3; studio creation → assignments → review flow → billing for Batch 12). |
| **4, 9** | Multi-session, partly human-in-loop | Coding fits ~2 sessions; App Store review / device testing / TestFlight processing time happens between sessions. |
| Real-device testing, App Store review, Stripe live-mode verification, beta-user feedback | **Doesn't fit any Claude session** | Apple, your customers, and your phone carrier are not Claude agents. Schedule wall-clock days for these. |

### Cowork + Dispatch specifics

- **Dispatch** can run multiple `start_code_task` sessions in parallel against worktrees. Useful for Batch 3 (audio pipeline) and Batch 12 (teacher tier) — multiple independent sub-features.
- The dispatcher (you, or me-as-orchestrator) coordinates: hands off artifacts via files in the repo, reads completion summaries, kicks off the next subtask.
- **Don't run more than 2–3 code sessions in parallel against the same repo** — merge conflicts get expensive fast. Use worktrees or sequence them.
- **For Batch 3 specifically:** decompose into 4 sub-sessions:
  1. Onset detection (`audio.py`, `test_audio.py`, fixture validation)
  2. DTW alignment (`alignment.py`, `test_alignment.py`)
  3. Classification + verdict (`classification.py`, `test_classification.py`)
  4. Orchestrator + integration (`analysis.py`, end-to-end fixture pass)
  Each sub-session gets a fresh context window — much better for tuning work where context bloat is the enemy.
- **For Batch 12:** 4 sub-sessions:
  1. Studio + invite flow
  2. Assignment creation + student fulfillment
  3. Teacher review screen + dashboard
  4. Teacher tier billing + seat-cap UX

### Specific advice for the critical-path batches (3, 4, 7)

These three are where the project's technical risk concentrates. Treat them differently from the rest.

**Batch 3 (audio analysis core):**
- Keep sessions short — 90 minutes each. Fresh context beats accumulated context for tuning work where you're staring at floating-point arrays.
- Fixtures are the cross-session memory. Phrase tasks as: "Last session this recording produced verdict X; tune until it produces Y."
- Don't re-read the giant audio file in each session. Look at the *output* of a test run, not the audio. The output JSON + a verdict in plain text is what you need to read; the WAV bytes aren't useful in context.
- After tuning, save the threshold values to `config.toml` and write a one-line note in `DECISIONS.md` explaining why.
- If a session goes sideways (you've made 4 tweaks and the regression is worse than where you started), abandon the session, revert, restart with a fresh context. Don't push through confused state.

**Batch 4 (async API + calibration):**
- The 12 calibration edge cases want a single session — knock them out together so the test suite covers them as one cohesive unit, not as 12 separate PRs.
- BackgroundTasks setup is short — it's one decorator and a sweeper job. It does *not* need its own session; bundle it with the analyses endpoint.
- Validate the calibration against actual phone-recorded clips before declaring DoD. Synthetic test audio passes too easily.
- The "Migration to Celery" subsection inside Batch 4 is its own future session, not part of the initial Batch 4 work. Trigger it on the criteria listed there (latency, volume, replicas, crash frequency) — don't pre-emptively migrate.

**Batch 7 (recording + analysis UI):**
- This is the user-facing core. Spend more time here than the schedule suggests.
- Test on a real iPhone in Safari early — `MediaRecorder` quirks on iOS are the #1 surprise. Don't develop only against Chrome on macOS.
- The result page is where the product becomes legible to users. Iterate the visual design with real recording outputs, not mocks. Showing dummy data hides UX problems that real noisy data exposes.
- If verdict copy feels weird ("you rushed by 4.2 BPM"), tune it after seeing 5–10 real outputs. Bad copy at this surface kills conversion.

**Universal rule for 3, 4, and 7:** if a session goes sideways, restart fresh rather than push through with a confused context. The cost of context-pollution on these three batches is higher than the cost of re-reading the spec from scratch.

---

## Batch 0 — Foundations (week 1, 2–3 days)

**Goal:** A reproducible dev environment with an empty backend that responds to `/health`, an empty React app that loads, and a CI pipeline that runs both. Nothing user-facing yet.

**Prereqs:** Node 22+, Python 3.12+, Docker, a GitHub account, an Anthropic API key, a Supabase account.

**Files / structure to create:**

```
intempo/
├── README.md
├── intempo-combined.md            # ← the master spec. Source of truth for every batch.
├── EDIT_LOG.md                    # ← every meaningful change goes here. See "Build-time activity logging."
├── DECISIONS.md                   # ← architectural "X over Y because Z" choices.
├── TUNING_LOG.md                  # ← stubbed now; populated during Batch 3 audio tuning.
├── docs/
│   └── intempo-design-preview.html  # ← rendered preview of the §3.5 aesthetic. Open before any UI batch.
├── .gitignore
├── .github/workflows/ci.yml
├── docker-compose.yml             # postgres only (no Redis until Celery migration — see project plan §11)
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                # FastAPI entrypoint
│   │   ├── config.py              # env var loader
│   │   ├── db.py                  # Supabase client
│   │   ├── routers/
│   │   │   └── health.py
│   │   └── tests/
│   │       └── test_health.py
│   └── Dockerfile
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── lib/
│   │       └── api.ts             # fetch wrapper
│   └── public/
├── mobile/                        # leave empty stub for now; bare RN comes in Batch 9
│   └── README.md
└── fixtures/
    ├── scores/
    └── audio/                     # Batch 3's six tuning clips land here when recorded
```

**Concrete steps:**

1. `mkdir intempo && cd intempo && git init && gh repo create --private`
2. **Commit the master spec and log files first.** Before any code, drop `intempo-combined.md` at the repo root and create the three log files alongside it:

   ```bash
   # From the repo root, after `git init`:
   cp /path/to/intempo-combined.md ./intempo-combined.md

   cat > EDIT_LOG.md <<'EOF'
   # InTempo Edit Log

   Newest entries at the top. Format spec: see "Build-time activity logging"
   in intempo-combined.md. Every meaningful change goes here — see that
   section for what counts as "meaningful."
   EOF

   cat > DECISIONS.md <<'EOF'
   # InTempo Decisions

   Architectural "X over Y because Z" choices only. Format: date, decision,
   alternatives considered, why we picked this. See intempo-combined.md
   Operating Principle #5.
   EOF

   cat > TUNING_LOG.md <<'EOF'
   # InTempo Audio Tuning Log

   Populated during Batch 3. Format spec: see "Batch 3 Tuning Appendix"
   in intempo-combined.md. Every threshold change logs old value, new
   value, regression results across all six fixture clips, and rationale.
   EOF

   mkdir -p docs
   cp /path/to/intempo-design-preview.html docs/intempo-design-preview.html

   git add intempo-combined.md EDIT_LOG.md DECISIONS.md TUNING_LOG.md docs/intempo-design-preview.html
   git commit -m "chore: initial spec, log files, and design preview"
   git tag spec-v1
   ```

   Why this is step 2, not step N: the spec and the logging discipline are the project's memory. Every subsequent step references them. Committing them first means every future commit happens under their rules.

3. **Backend:** `cd backend && uv init && uv add fastapi uvicorn[standard] python-dotenv supabase httpx anthropic pydantic`. Stub `main.py`:

   ```python
   from fastapi import FastAPI
   from app.routers import health

   app = FastAPI(title="InTempo API")
   app.include_router(health.router, prefix="/v1")

   @app.get("/")
   def root():
       return {"app": "intempo", "status": "ok"}
   ```

4. **Frontend:** `cd .. && npm create vite@latest frontend -- --template react-ts`. Add Tailwind, set up `api.ts` fetch wrapper.
5. **Docker compose** for local Postgres only. We don't add Redis here — Batch 4 uses FastAPI `BackgroundTasks` (in-process) and Redis comes in only when we hit the Celery migration triggers in project plan §11. Keep the compose file minimal until then.
6. **CI:** GitHub Actions workflow with two jobs (`backend-test`, `frontend-build`). Run on every PR.
7. **Secrets:** create `backend/.env.example` listing all the env vars (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, `STRIPE_SECRET_KEY`, etc.). Real `.env` is gitignored.
8. **Supabase setup:** create the project; copy URL + anon key + service-role key to `.env`.
9. **Write the first EDIT_LOG entry.** Follow the format from "Build-time activity logging." Title it "Batch 0 — initial scaffold." This proves the discipline works end-to-end before any real code is written, and it gives every future Claude session an example to copy.

**Tests / verification:**

- `curl localhost:8000/v1/health` → `{"status": "ok"}`
- `npm run dev` from frontend → renders default Vite splash
- CI green on a no-op commit
- `intempo-combined.md`, `EDIT_LOG.md`, `DECISIONS.md`, and `TUNING_LOG.md` all exist at repo root and are tracked in git

**Definition of Done:**

- ✅ Repo public on GitHub (or private + invited)
- ✅ Master spec + three log files committed at repo root, tagged `spec-v1`
- ✅ Both apps boot locally via a single command (`make dev` is nice-to-have)
- ✅ CI runs on PR
- ✅ Supabase project provisioned
- ✅ All API keys + DB connection strings stored in `.env` (never committed)
- ✅ First `EDIT_LOG.md` entry written for the Batch 0 scaffold itself
- ✅ `git tag batch-0-done` pushed

**Common pitfalls:**

- Mixing pip and uv. Pick uv. Don't mix.
- Forgetting `--template react-ts` and ending up with JS Vite. Painful to convert later.
- Storing the Supabase service-role key client-side. NEVER. It bypasses RLS.

---

## Batch 1 — Backend infra: auth, DB schema, storage (week 1–2, 3–4 days)

**Goal:** Authenticated `/v1/me` endpoint returning the current user. Database schema migrated. File storage (Supabase Storage or S3) provisioned with signed-URL upload flow.

**Prereqs:** Batch 0.

**Files created/modified:**

```
backend/app/
├── auth.py                        # JWT verification middleware
├── db.py                          # Supabase client + raw SQL helpers
├── models/
│   ├── __init__.py
│   ├── user.py                    # Pydantic models
│   ├── score.py
│   ├── analysis.py
│   └── assignment.py
├── routers/
│   ├── me.py                      # GET /v1/me
│   └── upload.py                  # presigned upload URLs
├── migrations/
│   ├── 001_initial.sql            # full schema from plan §2
│   └── 002_rls_policies.sql       # row-level security
└── tests/
    ├── test_auth.py
    └── test_me.py
```

**Concrete steps:**

1. **Schema migration.** Copy the SQL from `intempo-project-plan.md` §2 into `migrations/001_initial.sql`. Apply via Supabase SQL editor or `supabase db push`.
2. **RLS policies** (`002_rls_policies.sql`):

   ```sql
   alter table users enable row level security;
   create policy "users can read self" on users for select using (auth.uid() = id);
   create policy "users can update self" on users for update using (auth.uid() = id);

   alter table scores enable row level security;
   create policy "users can crud own scores" on scores
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

   alter table analyses enable row level security;
   create policy "users can read own analyses" on analyses
     for select using (auth.uid() = user_id);
   create policy "users can create own analyses" on analyses
     for insert with check (auth.uid() = user_id);

   -- Studios + assignments policies are more nuanced; defer to Batch 12.
   ```

3. **JWT middleware** (`auth.py`): verify Supabase JWT, extract `user_id`, attach to request state. Use `httpx` to call Supabase's `/auth/v1/user` for verification or decode locally with the Supabase JWT secret.
4. **`/v1/me` endpoint:** read current user from DB, return `{id, email, tier, studio_id, role}`.
5. **Storage bucket setup:** create `audio-uploads` and `score-images` buckets in Supabase Storage. Add upload policies (authenticated users can upload to their own folder).
6. **Presigned upload URLs:** `POST /v1/upload/audio` and `POST /v1/upload/score-image` return a signed URL the client can `PUT` directly to. This avoids streaming megabyte audio through your FastAPI server.

**Code stub — JWT middleware:**

```python
# app/auth.py
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from app.config import settings

bearer = HTTPBearer()

async def current_user_id(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    try:
        payload = jwt.decode(
            creds.credentials,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload["sub"]  # the user UUID
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=str(e))
```

**Tests:**

- `test_auth.py`: invalid token → 401; expired token → 401; valid token → user_id extracted
- `test_me.py`: unauthenticated → 401; authenticated → returns own user JSON
- `pytest backend/app/tests/` runs in CI

**Definition of Done:**

- ✅ All tables in DB
- ✅ RLS policies on user-owned tables
- ✅ `GET /v1/me` returns the authenticated user
- ✅ Both storage buckets exist with upload policies
- ✅ Presigned URL endpoint works (test: get URL, PUT a file, verify it's in the bucket)

**Common pitfalls:**

- Forgetting `audience="authenticated"` in jwt.decode → all tokens get rejected silently.
- Letting the client upload through the API server. 30MB files hit FastAPI body limits and tie up workers. Always presign.

---

## Batch 2 — Sheet music OCR pipeline (week 2–3, 4–5 days)

**Goal:** A POST `/v1/scores` endpoint that accepts a sheet music image, calls Claude Vision, validates the response against the score schema, persists it, and returns score JSON. Also: GET / PATCH endpoints for score reads and user corrections.

**Prereqs:** Batch 1 (auth + storage).

**Files:**

```
backend/app/
├── services/
│   ├── ocr.py                     # Claude Vision wrapper
│   └── score_schema.py            # Pydantic models for score JSON
├── routers/
│   └── scores.py                  # /v1/scores CRUD
├── prompts/
│   └── ocr_prompt.txt             # the OCR system prompt
└── tests/
    └── test_ocr.py
```

**Concrete steps:**

1. **Score JSON schema** (`score_schema.py`): port the JSON shape from project plan §6 into Pydantic v2 models. Strict validation; unknown fields rejected.
2. **OCR prompt:** copy the prompt from project plan §6 into `prompts/ocr_prompt.txt`. Externalize so we can iterate without redeploying.
3. **OCR service:** function `parse_sheet_music(image_bytes: bytes) -> ScoreJson`. Call Claude Sonnet 4.6 first; if confidence <0.7 OR validation fails, retry with Opus. After 2 failures, raise `OCRError`.
4. **Endpoint flow:**
   - Client uploads image to presigned URL (already from Batch 1)
   - Client POSTs `{ image_url, title?, composer? }` to `/v1/scores`
   - Server downloads the image, calls OCR, validates, persists, returns score JSON
5. **GET `/v1/scores/:id`** → fetch score by id (RLS enforces ownership)
6. **PATCH `/v1/scores/:id`** → user corrections to `score_json`. Whole-document replacement is fine for MVP; field-level patching is V2.

**Code stub — OCR service:**

```python
# app/services/ocr.py
import base64
from anthropic import Anthropic
from app.services.score_schema import ScoreJson
from pathlib import Path

PROMPT = Path("backend/app/prompts/ocr_prompt.txt").read_text()
client = Anthropic()

def parse_sheet_music(image_bytes: bytes, model: str = "claude-sonnet-4-6") -> ScoreJson:
    b64 = base64.standard_b64encode(image_bytes).decode()
    resp = client.messages.create(
        model=model,
        max_tokens=4000,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    )
    text = resp.content[0].text.strip()
    # Strip optional markdown fences
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return ScoreJson.model_validate_json(text)
```

**Tests:**

- `test_ocr.py`: feed in 5 fixture images (3 printed, 2 handwritten), assert the result parses as `ScoreJson` and has expected measure count. Cache responses in `fixtures/ocr_responses/` to avoid burning API tokens on each test run.
- Test the retry path: malformed mock response triggers retry to Opus.
- Test the auth path: unauthenticated POST → 401.

**Definition of Done:**

- ✅ Curl a JPEG to `/v1/scores`, get back validated score JSON in <10 sec
- ✅ DB has the score row with `score_json` populated
- ✅ Retry path tested
- ✅ 5 fixture scores parse correctly (or fail predictably with reason)

**Common pitfalls:**

- Claude returns JSON wrapped in markdown fences. The prompt says don't, but it sometimes does anyway. Strip fences defensively.
- Image size limits. Resize >2MB images client-side before upload. Claude's vision API has token costs that scale with image dimensions.
- Forgetting to escape special characters when storing the score_json in Postgres jsonb. Pydantic's `.model_dump()` produces clean dicts; just pass straight to the DB.

---

## Batch 3 — Audio analysis core (week 3–4, 5–6 days) — the hardest batch

**Goal:** A function `analyze(audio_bytes, score_json, target_bpm) -> AnalysisResult` that returns per-note timing deltas, classification bands, rolling trend, and a one-line verdict. Synchronous for now; we wrap in FastAPI `BackgroundTasks` in Batch 4 (and migrate to Celery later when the triggers in project plan §11 fire).

**Prereqs:** Batch 2 (we need the score_json shape).

**Files:**

```
backend/app/
├── services/
│   ├── audio.py                   # librosa wrapper
│   ├── alignment.py               # DTW + fuzzy matching
│   ├── classification.py          # tolerance bands + verdict
│   └── analysis.py                # orchestrator: ties the three together
├── tests/
│   ├── test_audio.py
│   ├── test_alignment.py
│   ├── test_classification.py
│   └── fixtures_test_recordings/
│       └── ... (10 recordings + expected outputs)
```

**Concrete steps:**

1. **`audio.py`:**
   - `load_audio(path) -> (waveform, sr)` — `librosa.load` at 22.05 kHz mono
   - `detect_onsets(y, sr) -> np.ndarray` — `librosa.onset.onset_detect` with the parameters from project plan §4 (delta=0.07 default, tunable via remote config)
   - `pre_emphasis(y) -> np.ndarray` — boost highs before onset detection
   - Apply a high-pass filter for double bass mode (configurable)
2. **`alignment.py`:**
   - `compute_expected_onsets(score_json, target_bpm) -> np.ndarray` — walk through the score, accumulate note durations at the target tempo, return seconds-since-start array
   - `align_dtw(detected, expected) -> AlignmentResult` — `librosa.sequence.dtw`, then walk the warping path. Returns mapping `detected_idx -> expected_idx`, plus alignment cost and `quality_score`.
   - `apply_fuzzy_match(alignment) -> CleanedAlignment` — handle one-to-many (missed notes) and many-to-one (extra/false-trigger notes) per project plan §7
   - `is_alignment_broken(quality) -> bool` — threshold check; returns True if we should refuse to report results
3. **`classification.py`:**
   - `compute_deltas(cleaned_alignment, target_bpm) -> List[Delta]` — for each matched note pair, compute (actual_time - expected_time) in ms and as % of beat
   - `classify_band(delta_pct) -> Band` — return `on / slight / rush_drag / severe` based on bands in §4
   - `rolling_trend(deltas, window=8) -> List[float]` — pandas-rolling-mean equivalent
   - `generate_verdict(deltas, classifications) -> Verdict` — natural-language one-liner: `"You rushed in measures 8–12 by an average of 4 BPM."`
4. **`analysis.py` orchestrator:**

   ```python
   def analyze(audio_path: Path, score: ScoreJson, target_bpm: float) -> AnalysisResult:
       y, sr = load_audio(audio_path)
       onsets = detect_onsets(pre_emphasis(y), sr)
       expected = compute_expected_onsets(score, target_bpm)
       raw_align = align_dtw(onsets, expected)
       if is_alignment_broken(raw_align.quality):
           return AnalysisResult(status="alignment_failed", quality=raw_align.quality)
       clean = apply_fuzzy_match(raw_align)
       deltas = compute_deltas(clean, target_bpm)
       classifications = [classify_band(d.pct) for d in deltas]
       trend = rolling_trend([d.pct for d in deltas])
       verdict = generate_verdict(deltas, classifications)
       return AnalysisResult(
           status="ok",
           per_note=[...],
           per_measure=[...],
           trend=trend,
           verdict=verdict,
           quality=raw_align.quality,
       )
   ```

5. **Configuration:** keep the threshold values (5% / 10% / 20% bands, onset delta, etc.) in a `config.toml` so we can tune without redeploying. In production these live in remote config (Supabase row, fetched on app start).

**Tests:**

- `test_audio.py`: feed 10 fixture recordings → assert N onsets within ±2 of expected count
- `test_alignment.py`: synthetic onset arrays (perfectly on tempo, rushed by 5%, missed note, extra note) → assert mapping is correct
- `test_classification.py`: hardcoded delta arrays → assert band classification matches expected
- `test_analysis.py`: full pipeline on 5 fixture pairs (recording + score JSON + expected verdict). Snapshot the output; if it changes, we want to know.

**Definition of Done:**

- ✅ `analyze()` runs end-to-end on a fixture pair in <15 sec
- ✅ Output JSON serializes cleanly
- ✅ All 10 fixture recordings produce reasonable verdicts (your subjective check; capture a "this is the baseline I shipped" snapshot)
- ✅ Alignment-broken path returns gracefully without crashing
- ✅ All threshold values externalized to config

**Common pitfalls:**

- librosa.sequence.dtw expects 2D arrays (features × time); pass `.reshape(-1, 1)` if your onsets are 1D.
- Onset detection is sensitive to `pre_max` / `post_max` — the defaults catch a lot of vibrato wobble. Tune against real recordings.
- Don't normalize audio before onset detection — peak-normalization eats real onsets.
- Save raw ROM-snapshot test fixtures with `pickle` or `np.savez`, not regenerate-on-test (which makes test flakiness silent).

---

## Batch 3 Tuning Appendix — A field guide for getting the audio analysis right

This appendix exists because Batch 3 broke me twice in earlier sessions before I built the dashboard described below. It is written as practical notes — read it before touching a threshold, not after.

### 1. Why Batch 3 tuning is different from every other batch

Every other batch in this document has a success condition Claude can verify on its own: auth works, the API returns 200, the UI renders, the migration applies cleanly. Batch 3's success condition is *"does this sound right to a musician,"* and Claude cannot hear the instrument.

The implication is not subtle: **all tuning must be driven by the developer feeding real, numerical data back into the prompting loop.** Claude can write the algorithm, propose threshold values, and explain why a result is what it is — but it cannot listen to your bass and tell you the second eighth note in bar 3 is sharp by 40ms. You have to listen, observe the dashboard, and report numbers back.

Treat Batch 3 less like "write code" and more like "operate a measurement instrument." The codebase is the instrument. Your ear and the dashboard are the readout. Claude is the assistant who turns the readout into the next adjustment.

If you skip the disciplines below — particularly the dashboard and the tuning log — you will spend a week tuning in circles without knowing it. I have done this. Don't.

### 2. Build the tuning dashboard before touching any thresholds

Before any threshold tuning begins, build a local web page that displays everything you need to see at once. A simple Flask or FastAPI app serving a single HTML page is plenty. Required widgets:

- **Waveform plot** of the recorded audio (full clip, time on x-axis, amplitude on y-axis)
- **Detected onsets** overlaid on the waveform as red dots at each detected timestamp
- **Expected onset grid** (from the score, scaled to target BPM) overlaid in a different color (blue) at the y=0 line so you can see the gap between expected and actual at a glance
- **Per-note deviation bar chart** below the waveform: for each matched note, a vertical bar whose height = `(actual_onset - expected_onset) * 1000` ms. Positive bars = late (dragging); negative bars = early (rushing). Color-code by tolerance band.
- **Parameter sidebar** showing the current values of every tunable parameter (`delta`, `pre_max`, `post_max`, `wait`, `hop_length`, tolerance-band cutoffs) and which fixture clip is loaded.
- **Clip selector** — a dropdown of all six fixture clips (see §3) so you can flip between them in one click.

Minimum viable scaffold:

```python
# tuning_dashboard/app.py
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from app.services.analysis import analyze_with_diagnostics
from app.config import settings

app = FastAPI()
templates = Jinja2Templates(directory="tuning_dashboard/templates")

FIXTURES = {
    "detache_clean": "fixtures/01_detache_clean.wav",
    "detache_rushing": "fixtures/02_detache_rushing.wav",
    "detache_dragging": "fixtures/03_detache_dragging.wav",
    "slurred": "fixtures/04_slurred.wav",
    "open_e_long": "fixtures/05_open_e_long.wav",
    "pizzicato": "fixtures/06_pizzicato.wav",
}

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, clip: str = "detache_clean"):
    audio_path = FIXTURES[clip]
    diag = analyze_with_diagnostics(audio_path)  # returns onsets, expected_grid, deviations
    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "clip": clip, "clips": list(FIXTURES.keys()),
        "waveform_b64": diag.waveform_png_base64,
        "detected_onsets": diag.detected_onsets,
        "expected_grid": diag.expected_grid,
        "deviations_ms": diag.deviations_ms,
        "params": settings.AUDIO,
    })
```

Use Plotly or Chart.js for the charts — both render server-side data into interactive plots in 20 lines. Don't build a custom canvas renderer. The point is speed of iteration.

**Why this is not optional polish.** Without the dashboard, the tuning feedback loop is: (1) edit a parameter, (2) re-run the test, (3) read JSON output, (4) try to mentally reconstruct what went wrong, (5) guess a new value. That loop is ~10 minutes per iteration and your guesses degrade as you get tired.

With the dashboard: edit parameter → reload page → eyes immediately go to the bar chart and the misaligned onsets. ~10 seconds per iteration. Over the ~80 iterations a real tuning pass takes, that's the difference between two days and two weeks.

### 3. The test corpus — record these specific clips before writing any tuning code

The 10 generic fixture recordings mentioned in the Batch 3 quick-start appendix are not enough. They prove the pipeline runs; they don't expose its failure modes. Record these six clips, *in this exact form*, before writing the tuning loop:

1. **`01_detache_clean.wav`** — 8 bars of slow détaché (quarter notes at 60 BPM works well), played as perfectly in time as you can manage. **This is your ground-truth baseline.** Practice this clip with a metronome until you'd be embarrassed for a teacher to hear it in any other state.
2. **`02_detache_rushing.wav`** — exact same passage, exact same notes, but played with deliberate rushing. Speed up gradually across the 8 bars; bar 8 should be noticeably faster than bar 1. Don't make it a step function — make it the kind of drift that real students do without noticing.
3. **`03_detache_dragging.wav`** — exact same passage, exact same notes, deliberately dragging. Slow down gradually. Same rules.
4. **`04_slurred.wav`** — at least 4 bars of a slurred passage. Pick something with several notes per slur (e.g. 4-note slurs). This is where onset detection breaks down by design; you're recording it so you can *see* the breakage on the dashboard.
5. **`05_open_e_long.wav`** — a single open E string note (low E on double bass) held for 2 seconds, then silence. Tests whether low-register onset detection fires at all on the lowest fundamental in your repertoire.
6. **`06_pizzicato.wav`** — at least 4 bars of pizzicato. Onset detection on pizz should be the easiest case (sharp transients); use this as a "this should always work" sanity check.

Store all six in a `/fixtures` folder in the repo. Commit them. They are not test data — they are *the spec* for what good output looks like.

**The regression rule.** Every threshold change must be tested against *all six* clips and regression-checked. Not just the clip that was causing the problem. The most common Batch 3 failure mode is: tweak `delta` to fix the slurred clip, ship it, regress detection on the open-E clip silently. The dashboard's clip selector is what makes this cheap.

### 4. One parameter at a time — the prompting discipline

When asking Claude to tune thresholds, change exactly one parameter and request three candidate values. Never say "fix the audio analysis" or "make it more accurate" — those prompts produce confident guesses unmoored from your data. Always paste the actual numbers from the dashboard.

The prompt pattern:

```
Here is the dashboard output for the rushing clip [02_detache_rushing.wav]:

  Detected onsets (s):
    0.012, 0.498, 0.987, 1.471, 1.952, 2.430, 2.901, 3.371, 3.836,
    4.298, 4.755, 5.211, 5.665, 6.116, 6.566, 7.014

  Expected onsets (s, scaled to target 60 BPM):
    0.000, 0.500, 1.000, 1.500, 2.000, 2.500, 3.000, 3.500, 4.000,
    4.500, 5.000, 5.500, 6.000, 6.500, 7.000, 7.500

  Deviations (ms): +12, -2, -13, -29, -48, -70, -99, -129, -164, -202,
                   -245, -289, -335, -384, -434, -486

  Detector found 16 onsets; expected 16. (Good count — bad timing, as expected
  on the rushing clip.)

The detector caught all onsets on this clip but I want to verify it stays
stable on the slurred clip — it currently misses 3 of 8 onsets there.
The missed onsets cluster in bar 2 of the slurred clip.

Change only the `delta` parameter (currently 0.07). Give me three versions
to test: 0.05, 0.07, and 0.09. Do not change pre_max, post_max, wait, or
the hop_length. I want to see which delta value preserves the rushing-clip
detection while improving the slurred-clip detection.
```

That prompt produces useful, falsifiable changes. The bare prompt "the slurred clip is broken, fix it" produces six lines of speculative changes across four parameters that you can't bisect.

The discipline rules:

- **One parameter per round.** If you must change two, do them as two sequential rounds with a dashboard check between them.
- **Three candidate values, not one.** Tuning is a search, not a guess. The middle value is usually the current value (control); the other two are bracketed around it. You'll learn the gradient direction faster.
- **Always paste real numbers.** If you don't have numbers to paste, you're not ready to tune — go run the dashboard first.
- **Always cite which clip the data came from.** "The detector is broken" is meaningless. "The detector misses 3 of 8 onsets on `04_slurred.wav` clustered in bar 2" is debuggable.

### 5. Tuning order — do not skip ahead

Tuning is sequential. Do not jump to the slurred clip or the tolerance bands while basic onset detection is still unstable. The order:

1. **Get onset detection working on `01_detache_clean.wav` first.** Ignore every other clip until detection on the clean clip is producing the right *count* of onsets and the deviations on the dashboard are visibly tight (within ±15ms). Nothing else matters until this passes.
2. **Test onset detection on the rushing and dragging clips.** Expect detection quality to degrade slightly — the audio is noisier when the player is intentionally drifting. Note exactly how many onsets are missed and where; that's your "acceptable degradation" baseline.
3. **Tune `delta` and `pre_max`/`post_max` until detection is stable across all three détaché variants.** Stable means: count is correct, no phantom onsets from vibrato wobble, no missed onsets on quiet attacks. This is the bulk of the tuning work; expect it to take several hours.
4. **Only then test `05_open_e_long.wav`.** Tune the pre-emphasis filter (boost 80–300 Hz) and harmonic tracking if the open-E onset isn't firing reliably. Low-register tuning is its own sub-problem; don't mix it in with the détaché tuning.
5. **Only then test `06_pizzicato.wav`.** Pizzicato should mostly work out of the box because the attacks are sharp. The thing to watch is *over-detection* — pizz string ring can register as multiple onsets on a single note. Tune the `wait` parameter (minimum inter-onset gap, ~60ms) to suppress this without losing real notes.
6. **Only then test `04_slurred.wav`.** Expect this to fail in v1. Document exactly how it fails — which onsets are missed, where, by how much — and write that into the v2 backlog. Do not torture the détaché clip's tuning to half-rescue the slurred clip; you'll lose more than you gain.
7. **Only after all six clips have stable onset detection do you touch the tolerance band thresholds** (the rushing/dragging % cutoffs). Tuning the bands while onset detection is still drifting is double-tuning two coupled systems and you will not converge.

The temptation to skip ahead is constant. Don't. Each step's stability is the input to the next step, and a regression three steps back is invisible until you re-run the regression suite.

### 6. How to set the tolerance bands empirically

Do not guess the tolerance band percentages. The defaults in the project plan (±5% / ±10% / ±20%) are reasonable starting values, but the *real* values come from your instrument, your room, and your ear. Procedure:

1. Run `02_detache_rushing.wav` through the pipeline. Record the actual `% deviation` numbers per note (the dashboard already shows these).
2. **Listen to the same clip yourself.** Mark the bar number where you, by ear, first hear the rushing as obvious. Write that down before you look at the numbers.
3. Read off the dashboard the % deviation that corresponds to the first note of that bar. **That is your "rushing" threshold.**
4. Repeat for `03_detache_dragging.wav`. The "dragging" threshold may be slightly different (humans are more tolerant of dragging than rushing — set it independently rather than mirroring).
5. Use those thresholds as the *outer* tolerance band (the red zone). The inner band (yellow zone) is roughly half that value — also empirical: find the % at which you just *barely* hear something off.

What you'll typically end up with:

```toml
# config.toml — tolerance bands derived from <your_name>'s ear, 2026-XX-XX
[tolerance]
rushing_inner_pct = 4.5     # below this = green
rushing_outer_pct = 11.0    # above this = red; between = yellow
dragging_inner_pct = 5.5    # asymmetric — humans tolerate dragging better
dragging_outer_pct = 13.0
```

Note the asymmetry. The defaults in the project plan are symmetric for simplicity but real tuning often produces asymmetric bands. Document it; don't fight it.

**Sanity check.** After setting the bands, re-run all six fixture clips through the full pipeline (analysis end-to-end, not just onset detection). Listen to each clip while reading the dashboard's color-coded verdict. The verdict's color should agree with what your ear is telling you ~90% of the time. Where they disagree, the dashboard wins on near-threshold cases (it's more consistent than your ear) but your ear wins on framing — if a clip you'd describe to a teacher as "totally fine" is showing up as red, the bands are too tight and you should widen them.

### 7. Logging every tuning decision

Create `TUNING_LOG.md` alongside the codebase from day one of Batch 3. Every parameter change goes in the log — not in a commit message, not in a Slack thread, in this file. The format:

```markdown
## 2026-XX-XX — change `delta` from 0.07 → 0.05

**Reason:** Slurred clip (04) was missing 3 of 8 onsets in bars 2–3.
Hypothesis: detector threshold too high to catch the soft attack of
notes inside a slur.

**Test results:**
- 01_detache_clean: still 8/8 onsets, deviations unchanged (±12ms range)
- 02_detache_rushing: still 16/16 onsets, deviations unchanged
- 03_detache_dragging: still 16/16 onsets, deviations unchanged
- 04_slurred: improved 5/8 → 7/8 onsets ✅ (still missing 1 in bar 3)
- 05_open_e_long: still 1/1 onset, fired at 0.043s (acceptable)
- 06_pizzicato: ⚠️ now firing 18 onsets on a 16-onset clip
  (2 phantom onsets from string ring on bar 4)

**Decision:** Keep delta=0.05. Compensate for pizzicato regression by
raising `wait` from 60ms → 80ms in the next round.

**Files touched:** config.toml, services/analysis.py (no logic change,
just reads new config value)
```

The log is what prevents the most insidious failure mode of audio tuning: **circular tuning.** You change `delta`, fix one clip, break another. You change `wait`, fix that clip, break a third. You change `delta` *back*, and now you've forgotten that `wait` is also different from where you started. Without the log, you find out three days later when nothing works and you can't remember the path that got you here.

The log also serves the next person who picks this up — including future-you, or a Claude session next month with no memory of this work. "Why is `pre_max=22` instead of the default 20?" is unanswerable without the log; with it, the answer is one grep away.

**Commit `TUNING_LOG.md` with every parameter change.** It is part of the codebase, not a personal note.

---

## Batch 4 — Async analysis API (week 4, 2–3 days)

**Goal:** `/v1/analyses` endpoint that queues an analysis job, returns immediately with `analysis_id`, processes asynchronously via **FastAPI `BackgroundTasks`**, and is pollable via `GET /v1/analyses/:id`. Plus `/v1/calibration` with all edge cases from project plan §4.

**Why BackgroundTasks, not Celery (yet):** see project plan §11 — Celery + Redis is the right long-term answer but adds real ops complexity (worker process, broker, dead-letter handling, "task didn't run" debugging) that's not justified before we know our real latency profile. BackgroundTasks runs in-process, ships in 30 minutes, and gets us to user feedback faster. We migrate when we hit documented triggers (covered in the "Migration to Celery" subsection at the end of this batch).

**Prereqs:** Batch 3 (the synchronous `analyze()` function).

**Files:**

```
backend/app/
├── workers/
│   └── analysis_runner.py         # Plain function; called by BackgroundTasks now,
│                                  #   wrapped as a Celery task at migration time
├── routers/
│   ├── analyses.py
│   └── calibration.py
└── tests/
    ├── test_analyses_api.py
    └── test_calibration.py
```

**Concrete steps:**

1. **Analysis runner:** thin wrapper around `services.analysis.analyze()`. Loads audio + score, calls `analyze`, writes result + status back to the `analyses` row. No Celery decorator — just a plain async function. The shape is deliberately Celery-compatible so migration is mechanical.
2. **POST `/v1/analyses`:**
   - Body: `{ score_id, audio_url, target_bpm, bpm_source }`
   - Insert row in `analyses` table with `status='queued'`
   - `background_tasks.add_task(run_analysis, analysis_id)` — FastAPI will execute it after the response is sent
   - Return `{ analysis_id, status: 'queued' }` immediately
3. **GET `/v1/analyses/:id`:**
   - Read from DB; if status='done', return full result; else return status only
4. **Stuck-job sweeper on startup.** BackgroundTasks doesn't survive process crashes, so on app startup we sweep `analyses` rows where `status IN ('queued', 'processing') AND updated_at < now() - interval '10 minutes'` and mark them `status='failed_recoverable'` with a clear message ("server restarted while analyzing — please retry"). Without this, crashed jobs spin forever in the UI.
5. **POST `/v1/calibration`:**
   - Body: `{ audio_url }` (or multipart upload for short clips)
   - Run all the validation checks from project plan §4 calibration spec
   - Return `{ bpm, confidence, ambiguity_options? }` or `{ error: <reason> }`

**Code stub — analysis runner (Phase 1, BackgroundTasks):**

```python
# app/workers/analysis_runner.py
import logging
from app.db import get_session
from app.services.analysis import analyze
from app.models import Analysis

log = logging.getLogger(__name__)

async def run_analysis(analysis_id: str) -> None:
    """Analysis worker. Phase 1: called via BackgroundTasks.
    Phase 2: this same function gets a `@celery_app.task` decorator and
    becomes `run_analysis.delay(analysis_id)` from the API layer. Body unchanged."""
    async with get_session() as db:
        a = await db.get(Analysis, analysis_id)
        if not a:
            log.error("analysis %s missing", analysis_id); return
        a.status = "processing"; await db.commit()

        try:
            audio = await fetch_audio(a.audio_url)
            score = await load_score_json(a.score_id)
            result = analyze(audio, score, a.target_bpm)  # synchronous; CPU-bound
            a.result_json = result
            a.status = "done"
        except RecordingTooNoisyError as e:
            a.status = "failed"; a.failure_reason = str(e)
        except Exception:
            log.exception("analysis %s failed", analysis_id)
            a.status = "failed"; a.failure_reason = "internal_error"
        finally:
            await db.commit()
```

**Code stub — endpoint enqueueing via BackgroundTasks:**

```python
# app/routers/analyses.py
from fastapi import BackgroundTasks
from app.workers.analysis_runner import run_analysis

@router.post("/v1/analyses")
async def create_analysis(
    req: AnalysisReq,
    background_tasks: BackgroundTasks,
    user_id=Depends(current_user_id),
):
    a = Analysis(user_id=user_id, score_id=req.score_id, audio_url=req.audio_url,
                 target_bpm=req.target_bpm, bpm_source=req.bpm_source, status="queued")
    db.add(a); await db.commit()
    background_tasks.add_task(run_analysis, a.id)
    return {"analysis_id": a.id, "status": "queued"}
```

**Code stub — calibration endpoint with edge cases:**

```python
# app/routers/calibration.py
from app.config import settings as s

CAL = s.CALIBRATION

@router.post("/v1/calibration")
async def calibrate(req: CalibrationReq, user_id=Depends(current_user_id)):
    audio = await fetch_audio(req.audio_url)
    y, sr = load_audio_bytes(audio)
    duration = len(y) / sr
    
    if duration < CAL["MIN_DURATION_S"]:
        return CalibrationResp(error="too_short", message="Hold a bit longer — at least 2 seconds.")
    if duration > CAL["MAX_DURATION_S"]:
        y = y[:int(CAL["MAX_DURATION_S"] * sr)]  # truncate
    
    peak_db = 20 * np.log10(np.max(np.abs(y)) + 1e-9)
    if peak_db < CAL["MIN_PEAK_DBFS"]:
        return CalibrationResp(error="too_quiet", message="Move closer to the mic and try again.")
    
    rms_db = 20 * np.log10(np.sqrt(np.mean(y**2)) + 1e-9)
    if rms_db < CAL["MIN_RMS_DBFS"]:
        return CalibrationResp(error="too_quiet", message="...")
    
    onsets = detect_onsets(y, sr)
    n = len(onsets)
    if n < CAL["MIN_ONSETS"]:
        return CalibrationResp(error="too_few_onsets")
    if n > CAL["MAX_ONSETS"]:
        return CalibrationResp(warning="too_many_onsets", bpm=infer_bpm(onsets))
    
    iois = np.diff(onsets)
    cv = np.std(iois) / np.mean(iois)
    if cv > CAL["IOI_CV_MAX"]:
        return CalibrationResp(error="inconsistent")
    
    bpm = 60.0 / np.median(iois)
    if bpm < CAL["BPM_MIN"] or bpm > CAL["BPM_MAX"]:
        return CalibrationResp(error="out_of_range")
    
    # Octave ambiguity check
    ambiguity = abs(bpm - 2*round(bpm/2)) / bpm
    if ambiguity > CAL["OCTAVE_AMBIGUITY_THRESHOLD"]:
        return CalibrationResp(bpm=bpm, alternates=[bpm * 2, bpm / 2])
    
    return CalibrationResp(bpm=bpm)
```

**Tests:**

- `test_analyses_api.py`: POST → returns analysis_id; poll until done; result JSON matches expected shape. Use FastAPI's `TestClient` which executes BackgroundTasks synchronously after the response, making this easy to test.
- `test_calibration.py`: feed 10 calibration clips (good, too quiet, too short, octave-ambiguous, etc.) and assert the right response branch fires for each.
- **Crash-recovery test:** insert a row with `status='processing'` and `updated_at` set to 15 minutes ago, restart the app, assert the sweeper marks it `failed_recoverable`.

**Definition of Done:**

- ✅ POST `/v1/analyses` returns `analysis_id` in <500ms (the response returns before the analysis runs)
- ✅ Background task completes in <30 sec for a 60-sec recording
- ✅ Polling `/v1/analyses/:id` shows progression: `queued → processing → done`
- ✅ All 12 calibration edge cases return correct error/warning codes
- ✅ Failing analyses surface `status='failed'` with a reason, not silent timeouts
- ✅ Stuck-job sweeper recovers crashed-mid-analysis rows on app startup

**Common pitfalls (Phase 1):**

- **Don't put long sync work directly in the request handler thinking BackgroundTasks magically parallelizes.** It runs *after* the response is sent, in the same event loop. If `analyze()` is CPU-bound and synchronous, it blocks the event loop while it runs. Wrap CPU-bound work with `asyncio.get_running_loop().run_in_executor(None, analyze, ...)` so it runs in a thread pool and other requests still get served.
- **Don't re-use a DB session across the handler and the background task.** The handler's session closes when the response returns. Open a fresh session inside `run_analysis`.
- **No retries.** If the analysis fails transiently (network blip fetching audio), the user has to manually retry. That's acceptable for MVP; document it. Don't try to add retry logic in Phase 1 — that's exactly what Celery is for.
- **Single-instance assumption.** This works because we have one backend replica at MVP. The day we add a second replica behind a load balancer, we *must* be on Celery (or the analysis happens on whichever replica handled the upload, with no load balancing across them).

### Migration to Celery — when, what, and how

**When to migrate.** Trigger on any of (matches project plan §11):

- p95 analysis latency > 25s (approaching the BackgroundTasks ceiling)
- > 200 analyses per day, OR > 5 concurrent analyses regularly observed
- Deploying a second backend replica
- Job-loss-from-crashes happens twice in a single week
- Adding the LLM second-opinion fallback from project plan §7.5

**What changes (the migration is small because we structured it right):**

```
backend/app/
├── celery_app.py                     # NEW — Celery init + config
├── workers/
│   └── analysis_runner.py            # CHANGED — add @celery_app.task decorator
└── routers/
    └── analyses.py                   # CHANGED — background_tasks.add_task → .delay
```

The `run_analysis` function body doesn't change. Same DB writes, same return shape, same exception handling. We add the task decorator on top and swap the enqueue call:

```python
# Phase 2: app/workers/analysis_runner.py
from app.celery_app import celery_app

@celery_app.task(bind=True, time_limit=120, soft_time_limit=100, max_retries=2)
def run_analysis(self, analysis_id: str) -> None:
    # ... same body as Phase 1, but sync (Celery prefork doesn't love asyncio)
    # use asgiref.async_to_sync where needed for DB
```

```python
# Phase 2: app/routers/analyses.py
@router.post("/v1/analyses")
async def create_analysis(req: AnalysisReq, user_id=Depends(current_user_id)):
    a = Analysis(...); db.add(a); await db.commit()
    run_analysis.delay(a.id)  # was: background_tasks.add_task(run_analysis, a.id)
    return {"analysis_id": a.id, "status": "queued"}
```

**Plus the ops work:**

1. Add Redis to docker-compose (and to the deployed environment — Upstash or Render Redis are the easy paths).
2. Run a Celery worker as a separate process: `celery -A app.celery_app worker --concurrency=2`.
3. Set `task_time_limit=120` (hard kill at 2 min) and `soft_time_limit=100` (raises an exception you can catch and clean up).
4. Configure result backend = Redis with TTL (we read results from Postgres, not the Celery result backend, so the result backend mostly exists for `.get()` debugging).
5. Wire Sentry to the Celery worker (`celery_app.signals.task_failure`).
6. Update CI to spin up Redis for integration tests.
7. Deployment: a separate worker dyno/container alongside the API container.

**Common pitfalls (Phase 2):**

- **Celery + asyncio:** don't `await` inside the task; make the task sync. Use `asgiref.async_to_sync` if you must call async DB code.
- **Redis connection leaks.** Use connection pooling (`broker_pool_limit`).
- **Forgetting time limits.** A wedged librosa call will hang a worker forever. Set `task_time_limit=120` (2 min hard kill).
- **The migration PR is the dangerous one.** Do it on a quiet day. Run both pipelines in parallel (BackgroundTasks AND a Celery task that no-ops) for 24 hours so you can observe Celery latency before flipping the enqueue path.

---

## Batch 5 — Web frontend foundation (week 5, 3–4 days)

**Goal:** A React + TypeScript + Tailwind frontend with auth (Supabase), routing, layout, and a stubbed home/dashboard. No real product features yet — this is the shell.

**Prereqs:** Batch 1 (auth backend works).

**Files:**

```
frontend/src/
├── main.tsx
├── App.tsx
├── routes/
│   ├── HomeRoute.tsx
│   ├── LoginRoute.tsx
│   ├── ScoreCaptureRoute.tsx        # stub
│   ├── ScoreListRoute.tsx           # stub
│   ├── RecordRoute.tsx              # stub
│   └── ResultRoute.tsx              # stub
├── components/
│   ├── Layout.tsx
│   ├── Header.tsx
│   ├── ProtectedRoute.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Toast.tsx
│       └── ...
├── hooks/
│   ├── useAuth.ts                   # Supabase Auth wrapper
│   └── useApi.ts                    # tanstack-query wrapper
├── lib/
│   ├── supabase.ts
│   ├── api.ts                       # typed fetch with auth header
│   └── analytics.ts                 # Posthog wrapper
└── styles/
    └── tokens.ts                    # design tokens (parchment / cream / ink palette from earlier)
```

**Concrete steps:**

1. Install: `npm i @supabase/supabase-js @tanstack/react-query react-router-dom zustand posthog-js`
2. **Auth:** Supabase Auth UI for email/magic link. After login, fetch `/v1/me` and stash in Zustand store.
3. **Router:** React Router v7. Routes: `/`, `/login`, `/scores`, `/scores/new`, `/scores/:id`, `/scores/:id/record`, `/analyses/:id`, `/account`.
4. **Protected routes:** redirect to `/login` if no session.
5. **Design tokens:** establish the palette upfront. Cream `#fbf4de`, ink `#1a140a`, gold `#8a6212`, etc. Same theme as the AP Euro work — feel familiar to the dev.
6. **Layout shell:** header with logo/auth state, main content area, footer with version + status link.
7. **API helper:** typed fetch wrapper that auto-attaches the Supabase JWT and serializes errors.

**Code stub — useApi:**

```ts
// hooks/useApi.ts
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const apiBase = import.meta.env.VITE_API_URL!;

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  return r.json();
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => authedFetch<{ id: string; email: string; tier: string }>("/v1/me") });
}
```

**Tests:**

- Cypress / Playwright: signup → login → see logged-in state
- Manual: visit each stubbed route; ensure protected routes redirect

**Definition of Done:**

- ✅ Magic-link login works end-to-end
- ✅ All stubbed routes accessible (no 404s)
- ✅ Logged-in user sees their email in the header
- ✅ Logout clears session
- ✅ Refresh persists session
- ✅ E2E test for happy-path login

**Common pitfalls:**

- Supabase magic link redirect URL — set it correctly in Supabase dashboard (`localhost:5173/auth/callback`)
- Storing JWT in localStorage manually. Don't — Supabase handles this. Just call `supabase.auth.getSession()`.
- React Query stale-while-revalidate caching the wrong tier after upgrade. Invalidate on subscription change.

---

## Batch 6 — Score capture flow (web, week 6, 4–5 days)

**Goal:** User can take a photo (or upload an image) of sheet music, see the parsed score, edit any errors, and save.

**Prereqs:** Batch 2 (OCR endpoint), Batch 5 (frontend shell).

**Files:**

```
frontend/src/
├── routes/
│   └── ScoreCaptureRoute.tsx
├── components/
│   ├── score/
│   │   ├── CameraCapture.tsx          # uses getUserMedia
│   │   ├── ImageUploader.tsx          # fallback for desktop
│   │   ├── ScorePreview.tsx           # renders parsed score
│   │   ├── ScoreEditor.tsx            # edit individual notes/measures
│   │   └── ScoreSaveBar.tsx
│   └── ui/
│       └── ProgressBar.tsx
└── hooks/
    └── useScoreUpload.ts
```

**Concrete steps:**

1. **Camera capture (mobile web):** `getUserMedia({ video: { facingMode: "environment" } })`. Show live feed, capture frame on tap.
2. **Image preview + adjust:** crop, rotate, brightness/contrast slider. Use a canvas-based editor or a library like `cropperjs`.
3. **Upload flow:**
   - Get presigned URL from backend
   - PUT image directly to storage
   - POST `/v1/scores` with image URL
   - Poll until OCR completes (or use SSE/WebSocket — but polling at 1Hz is fine for MVP)
4. **Score preview:** render the parsed JSON as a simple list (Measure 1: notes [D, E, F#, ...]). V2 will use Verovio for proper notation rendering; MVP just shows the data.
5. **Edit UI:** click any note to fix pitch/duration. Edit measure-by-measure or in a flat list view. Save sends PATCH to `/v1/scores/:id`.
6. **Confidence surfacing:** if OCR returned `ocr_confidence < 0.7`, show a banner: "Some measures looked uncertain — please review."

**Tests:**

- Cypress: upload a fixture image → verify OCR completes → verify edit saves → verify reload shows edits
- Manual: test on a real iPhone in Safari (camera flow)

**Definition of Done:**

- ✅ End-to-end: take photo → see parsed score → edit → save → reload preserves edits
- ✅ Works on iPhone Safari camera
- ✅ Low-confidence OCR surfaces a warning
- ✅ Image processing < 10 sec on typical 4G connection

**Common pitfalls:**

- iOS Safari requires user gesture for `getUserMedia`. Don't auto-start the camera.
- Image orientation EXIF data — strip it client-side or rotation will be wrong on the server.
- `<input type="file" accept="image/*" capture="environment">` is a useful one-line fallback if the custom camera UI is buggy.

---

## Batch 7 — Recording + analysis flow (web, week 7, 5–6 days)

**Goal:** User picks a saved score, sets target tempo (manual or via calibration clip), records audio, submits for analysis, sees results.

**Prereqs:** Batches 3, 4, 6.

**Files:**

```
frontend/src/
├── routes/
│   ├── RecordRoute.tsx
│   └── ResultRoute.tsx
├── components/
│   ├── record/
│   │   ├── TempoSelector.tsx          # manual BPM dial + "calibrate instead" option
│   │   ├── CalibrationFlow.tsx        # 2-second record + retry logic
│   │   ├── RecordingPanel.tsx         # main record + playback + redo
│   │   ├── MetronomeToggle.tsx        # off/visual; web has no native haptic so haptic is mobile-only
│   │   ├── VisualMetronome.tsx        # full-screen border flash on each beat (driven by Web Audio scheduler)
│   │   └── SubmitButton.tsx
│   ├── result/
│   │   ├── VerdictCard.tsx            # one-line verdict
│   │   ├── AnnotatedScore.tsx         # color-coded per-measure
│   │   ├── TrendChart.tsx             # rolling-average chart (victory or recharts)
│   │   └── PerNoteDetail.tsx          # collapsible deep-dive
│   └── ui/
│       └── WaveformPreview.tsx
└── hooks/
    ├── useRecorder.ts                  # MediaRecorder API wrapper
    ├── useVisualMetronome.ts           # schedules beat callbacks via Web Audio's audioContext.currentTime
    └── useAnalysisPolling.ts           # poll /v1/analyses/:id
```

**Optional metronome — visual only on web.** When the user turns on the metronome toggle, the recording flow drives a full-screen border flash via `useVisualMetronome` synced to the target BPM. The hook uses `audioContext.currentTime`-based scheduling (not `setInterval`, which drifts) but never *plays* anything — `audioContext` is just the clock. The recording component records the user's instrument as normal; the visual click adds zero signal to the recorded audio, so the existing analysis pipeline doesn't change. Haptic mode does nothing on web (browsers don't expose phone vibration reliably) — the toggle should hide haptic on web, show it on mobile in Batch 9. Submit the analysis with `metronome_mode: 'visual' | 'off'` so telemetry can track usage.

**Concrete steps:**

1. **TempoSelector:** number input + +/- arrows + "tap tempo" button (multi-tap to set BPM). Default: score's `bpm_hint` if present.
2. **Calibration flow:** "Play 2 seconds at your tempo" → record → POST `/v1/calibration` → handle all 12 response branches with appropriate UI (toast, retry, ambiguity picker).
3. **Recording panel:**
   - Big record button (red when recording)
   - Visual waveform during record
   - Stop, playback to verify, redo, submit
   - 5-min hard cap; warn at 4:30
4. **Submit:** upload audio via presigned URL, POST `/v1/analyses`, navigate to `/analyses/:id`.
5. **Result polling:** `useAnalysisPolling` hits the endpoint every 2 sec until `status === 'done'`. Show a progress message ("Analyzing... ~12 seconds").
6. **Result page:**
   - **VerdictCard** at the top (largest text on screen)
   - **AnnotatedScore** below: server returns measure-level summary; render colored boxes (green/yellow/orange/red) per measure with measure number underneath
   - **TrendChart**: x-axis = note index, y-axis = BPM deviation, gold line = rolling average, dashed line at 0
   - **PerNoteDetail** collapsed by default; expand to see every onset's delta

**Tests:**

- E2E: record a fixture audio (use a test microphone shim) → submit → result renders
- Snapshot tests on result components with mock data

**Definition of Done:**

- ✅ Full flow from /scores/:id → record → result page works end-to-end
- ✅ Calibration handles at least 5 of the 12 edge cases gracefully (the rest can be V2 polish)
- ✅ Results render in under 30 sec from "submit" click
- ✅ Mobile-friendly layout (test on iPhone width)
- ✅ Annotated score readable on a 4-inch screen

**Common pitfalls:**

- MediaRecorder produces `audio/webm` on most browsers, not `audio/wav`. Backend must accept webm or convert (ffmpeg) before librosa. Use `librosa.load(audio_path)` — it shells out to soundfile/ffmpeg.
- iOS Safari MediaRecorder only ships in iOS 14.3+. Test specifically.
- Result polling: stop polling on tab blur to avoid background battery drain.

---

## Batch 8 — Free tier + Stripe + Pro upgrade (web, week 8, 3–4 days)

**Goal:** Free users limited to 3 analyses/month. Upgrade flow via Stripe Checkout. Pro tier removes limits and adds saved history.

**Prereqs:** Batch 7.

**Files:**

```
backend/app/
├── routers/
│   ├── billing.py                      # /v1/billing/checkout, /v1/billing/webhook
│   └── tier_limits.py                  # decorator: enforce_tier_limits
└── services/
    └── stripe_client.py

frontend/src/
├── routes/
│   ├── PricingRoute.tsx
│   └── AccountRoute.tsx
├── components/
│   ├── billing/
│   │   ├── PaywallModal.tsx
│   │   └── UpgradeButton.tsx
└── hooks/
    └── useTier.ts
```

**Concrete steps:**

1. **Stripe setup:** create product (Pro Monthly, Pro Annual, Teacher Monthly, Teacher Annual). Webhook endpoint must verify the Stripe signature.
2. **Tier enforcement (backend):** decorator on `/v1/analyses` POST that counts the user's analyses in the current calendar month. If `tier='free'` and count ≥ 3, return 403 with `{ code: 'tier_limit', limit: 3, used: 3 }`.
3. **Webhook handler:** `customer.subscription.created/updated/deleted` events. Update `users.tier` accordingly.
4. **Frontend:**
   - Show "X / 3 analyses used this month" in header for free users
   - On 4th submit attempt, show paywall modal instead of submitting
   - Pricing page: Pro Monthly $7.99, Annual $59 (save 38%), Teacher coming soon
   - Account page: current tier, "Manage subscription" → Stripe Customer Portal
5. **Stripe Customer Portal** for self-service cancellation/upgrade.

**Tests:**

- Backend: mock 4th submit → assert 403
- Webhook: replay a subscription event → assert tier updates
- Frontend E2E: hit limit → see paywall → upgrade → unlimited

**Definition of Done:**

- ✅ Free user sees usage counter
- ✅ 4th submit blocks with paywall
- ✅ Stripe Checkout completes → user is `tier='pro'` within 5 sec
- ✅ Cancel via Customer Portal → `tier='free'` after period end
- ✅ Webhook signature verified (test with Stripe CLI)

**Common pitfalls:**

- Webhook signature verification using the wrong secret. Stripe gives you separate secrets per endpoint. Use the right one.
- Forgetting to handle `subscription.deleted` → user keeps Pro forever. Test the cancel path.
- Stripe Checkout sessions can be replayed. Use `client_reference_id` and check it matches the user before granting tier.

---

## Batch 9 — Native iOS via React Native (week 9–11, ~10 days)

**Goal:** A native iOS app shipped to TestFlight. Same React component library as web, with native camera, audio recording, and IAP for subscriptions.

**Prereqs:** Batches 7 & 8 working solidly on web; Apple Developer account paid for.

**Files:**

```
mobile/
├── package.json
├── app.json                          # Expo config (we use bare workflow)
├── ios/                              # native iOS project
├── src/                              # 90% shared with web via react-native-web
│   ├── App.tsx
│   ├── routes/...
│   └── components/...
└── eas.json                          # EAS Build config
```

**Concrete steps:**

1. **Bare RN init:** `npx create-expo-app -t bare-minimum mobile`. Add `@react-native-async-storage/async-storage`.
2. **Share code with web:** symlink or workspace-link `frontend/src/components` → `mobile/src/components`. Use `react-native-web` so most components render in both. Native-only pieces (camera, audio recorder) get split:
   - `Camera.web.tsx` (browser getUserMedia)
   - `Camera.native.tsx` (react-native-vision-camera)
   - Bundler picks the right one.
3. **Audio recording:** `react-native-audio-recorder-player`. Save to local AAC. Upload via presigned URL.
4. **Native haptic metronome.** The metronome toggle now exposes the haptic mode (hidden on web in Batch 7). Use `expo-haptics` (`Haptics.impactAsync(ImpactFeedbackStyle.Medium)` per beat) scheduled via `requestAnimationFrame` plus a drift-corrected timer based on `Date.now()`. **Do not** use `setInterval` for the beat clock — it drifts noticeably over a 4-minute recording. Visual mode also gains a haptic option here for users who want both. Submit `metronome_mode: 'haptic' | 'visual' | 'off'`. Audio mode is V2 and not built in this batch.
5. **In-App Purchase:** RevenueCat. Configure products in App Store Connect, mirror in RevenueCat dashboard. RC SDK handles validation; backend webhook updates `users.tier`.
6. **EAS Build:** `eas build --platform ios --profile preview` for TestFlight builds.
7. **App Store Connect:**
   - Create app, fill in metadata (name, subtitle, keywords, screenshots, preview video)
   - Set up subscription products + intro pricing if any
   - Add privacy policy URL
   - Submit for review

**Apple-specific things to get right:**

- **Subscription disclosure** on the upgrade screen: title, price per period, length of trial, auto-renew terms, link to Terms of Service. Apple rejects apps that don't show all five.
- **Privacy nutrition labels** in App Store Connect: declare audio recording, score images, account data.
- **App Tracking Transparency (ATT) prompt** if you do any tracking. Posthog session recordings probably need it.

**Tests:**

- TestFlight beta with 10–20 testers
- Manual: full flow on iPhone 12, iPhone 14, iPhone SE
- Subscription test: buy → verify tier upgrade → cancel → verify renewal stops

**Definition of Done:**

- ✅ App on TestFlight, no crashes on submit
- ✅ Full flow (capture → record → analyze → result → upgrade) works on real device
- ✅ IAP completes; tier updates within 5 sec via RevenueCat webhook
- ✅ Submitted to App Store review
- ✅ All Apple subscription disclosures present

**Common pitfalls:**

- Bundle identifier mismatch between Apple Developer account, App Store Connect, EAS build, and `app.json`. Get them aligned before first build.
- Microphone permission prompt requires `NSMicrophoneUsageDescription` in `Info.plist`. RN doesn't auto-add this.
- Camera permission similarly: `NSCameraUsageDescription`.
- TestFlight builds take 10–30 min to process after upload. Plan around it.

---

## Batch 10 — Offline support (week 12, 4–5 days)

**Goal:** App works without connectivity for capture and recording; syncs when back online.

**Prereqs:** Batch 9.

**Files:**

```
mobile/src/
├── lib/
│   ├── localDb.ts                    # SQLite (react-native-quick-sqlite)
│   ├── syncQueue.ts                  # queue + sync logic
│   └── connectivity.ts               # NetInfo + captive portal detection
└── components/
    └── SyncStatusBar.tsx
```

**Concrete steps:**

1. **Local DB schema:**

   ```sql
   create table pending_uploads (
     local_id integer primary key autoincrement,
     type text not null,                  -- 'ocr' | 'analysis' | 'calibration'
     payload_path text not null,          -- file path on device
     metadata_json text,                  -- score_id, target_bpm, etc
     attempts integer default 0,
     last_error text,
     created_at integer
   );
   create table cached_scores (
     score_id text primary key,
     score_json text,
     synced_at integer
   );
   ```

2. **On record:** if offline, write audio + metadata to `pending_uploads`. Show "Queued — will sync when online" toast.
3. **On connectivity restored** (NetInfo listener): drain queue. For each item: presigned URL upload → POST endpoint → mark synced.
4. **Background sync** (iOS): `BGAppRefreshTask` registered for ~15 min intervals. Best-effort; iOS controls scheduling.
5. **Captive portal detection:** before any POST, HEAD `apple.com/library/test/success.html`; if redirected, show banner.
6. **UI:** `SyncStatusBar` shows pending count + last sync time. Tap to manually retry.

**Tests:**

- Manual: airplane mode → record → exit airplane → assert sync completes within 30 sec
- Captive-portal simulation (use iOS Personal Hotspot with portal sign-in)
- Force a sync failure (kill backend) → exponential backoff visible

**Definition of Done:**

- ✅ Record works offline; appears in queue
- ✅ Reconnect triggers automatic sync
- ✅ Background sync works while app is closed (test by recording, closing app, going online, waiting, opening app — should see analysis)
- ✅ Captive portal surfaces a useful message
- ✅ Queue persists across app kills/reinstalls (within reason)

**Common pitfalls:**

- iOS background tasks have unpredictable scheduling. Don't depend on them firing within X minutes; just register the handler and let iOS decide.
- File path persistence: iOS may rotate the document directory path on app updates. Store relative paths, resolve on read.
- Queue item dedup: if user retries manually while sync is in flight, you'll get double uploads. Use idempotency keys.

---

## Batch 11 — Telemetry, beta cohort, polish (week 13, 4–5 days)

**Goal:** Ship to a private beta of 50–200 users. Hit "would recommend to a friend" quality.

**Prereqs:** All prior batches.

**Concrete steps:**

1. **Sentry:** wire up backend + frontend + mobile. Alert on >0.5% error rate.
2. **Posthog:** track key events (signup, first score, first analysis, paywall hit, upgrade, churn). Feature flag for tiered rollouts.
3. **Beta onboarding:** 50 invite codes via TestFlight + 200 web invites via gated signup
4. **Feedback widget:** in-app "send feedback" button → posts to a Slack webhook or a Posthog event
5. **Bug triage:** hit Inbox Zero on Sentry weekly
6. **Launch readiness checklist:**
   - [ ] Privacy policy + ToS pages live
   - [ ] Support email working (`hello@intempo.app`)
   - [ ] Apple subscription disclosures verified
   - [ ] Stripe in live mode
   - [ ] Free tier limits actually enforce in production
   - [ ] Webhook endpoints are HTTPS + signature-verified
   - [ ] Sentry alerts wired to your phone (Telegram, SMS, whatever)

**Definition of Done:**

- ✅ 30+ active beta users
- ✅ NPS ≥ 30 from beta survey
- ✅ <0.5% backend error rate over 7 days
- ✅ Sentry inbox under 10 unresolved
- ✅ Apple review feedback addressed (if any)

---

## Batch 12 — Teacher tier (V2, week 14–17, ~3 weeks)

**Goal:** Teachers can create studios, invite students, assign pieces, review submissions.

**Prereqs:** Batch 11; product has paying users.

**Concrete steps:**

1. **Studio creation flow** (teacher signup): `POST /v1/studios` returns invite code
2. **Student joining:** signup screen has an "I have an invite code" path; entering it links them to the studio + bumps tier
3. **Assignment creator (teacher):** new screen — pick students, score, target_bpm, due date, notes
4. **Assignment list (student):** "Assigned" tab with pending/due items
5. **Submit-as-assignment:** when student records, "Submit to teacher" button creates `analyses.assignment_id` link + transitions assignment status
6. **Teacher dashboard:** list of submissions with status, click to review, leave notes (`teacher_review_notes`)
7. **Notifications:** push (mobile) + email (web) for both sides
8. **Teacher billing:** Stripe Subscription product for Teacher tier ($19.99/mo, 25 seats); seat overflow upgrade flow

**Definition of Done:**

- ✅ 5 paid teacher accounts onboarded
- ✅ Each has at least 3 students using assignments
- ✅ Submission → review loop tested end-to-end
- ✅ Seat-cap enforcement works

---

## Batch 13 — App Store launch + marketing (week 18, 1–2 weeks)

**Goal:** Public launch. Drive 1,000 installs in 30 days.

**Concrete steps:**

1. **App Store launch:** approved app goes live. Coordinate with marketing.
2. **Reddit posts:** r/cello, r/violinist, r/Bass — "I built this — feedback?" thread, no marketing language. Link to landing page, not direct App Store (so users see the explanation first).
3. **YouTube creator outreach:** 3–5 paid integrations ($500–1500 each). Aim for music education or comedy/explainer (TwoSet, Adam Neely-adjacent).
4. **App Store Optimization:** keywords (`tempo`, `metronome`, `practice`, `sheet music`, `violin`, `cello`, `bass`), title, subtitle, screenshots in the priority order from the project plan.
5. **Marketing site:** landing page, blog, pricing, support
6. **Email sequence:** welcome → tips → upsell. Use Resend or Postmark.

**Definition of Done:**

- ✅ App live on App Store
- ✅ 1,000 installs in first 30 days
- ✅ 50+ paying subscribers
- ✅ MRR > $250

---

## Batch 14+ — V2 + Android (post-launch)

This is where the project plan's open questions get answered with real data. Likely priorities:

- **Android port** (only if iOS hits the 40% M1 retention + 500 paid gate from §9 of the project plan)
- **Slur detection** (when user feedback says detaché-only is too limiting)
- **On-device analysis** (when latency feedback gets loud)
- **Score sharing for studios** (teacher tier feedback)
- **Tablet layout** (iPad rep is high among music teachers)

Don't pre-build any of these. Let user demand drive the order.

---

## Quick reference: what to do TODAY if you're picking this up

1. Provision Anthropic + Supabase + Stripe accounts. (15 min)
2. Run Batch 0. (1 day)
3. Curate the 10 fixture scores + 10 fixture audio recordings. (1 hour with a friend or yourself playing)
4. Hit Batch 1 + 2 in parallel; the rest is sequential.

The hardest batch by a wide margin is **Batch 3** (audio analysis core). Budget 1.5–2× the time you think it'll take. The rest of the plan is plumbing around that core.

---

*End of build plan. Update this doc as batches ship or scopes shift. Keep `DECISIONS.md` parallel with this for the "why we picked X" trail.*
