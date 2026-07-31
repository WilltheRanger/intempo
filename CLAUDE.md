# CLAUDE.md — working agreement for InTempo

This file is read at the start of every Claude session. It is binding.
`intempo-combined.md` is the source of truth for *what* to build;
this file is *how* we work while building it.

## 1. Follow the developer procedures — every session, no exceptions

These are the "Operating principles" and "Build-time activity logging"
rules from `intempo-combined.md` Part II. They are not optional polish.

**The four logs — keep them current as you work:**

| File | When to write | What goes in |
|---|---|---|
| `EDIT_LOG.md` | After every meaningful change (~5–30 min granularity) | Newest entry at the TOP. What changed, why, tests run, known side effects, rollback. Use the format already in the file. |
| `DECISIONS.md` | Only on a real "X over Y because Z" architectural call | Context, decision, alternatives considered, trade-offs accepted. |
| `TUNING_LOG.md` | Every Batch 3 audio-threshold change | Old value → new value, clip-by-clip regression across all six fixtures, rationale. |
| Git history | Every commit | Atomic, frequent, descriptive commits. |

**The rest of the operating principles:**

1. **Branch per batch** (`feat/batch-N-...` or the session's assigned branch). Squash to main on DoD.
2. **One fixture file per tricky endpoint** — save the raw response to `fixtures/`, test against it forever. Never call a real LLM/paid API in CI.
3. **Don't optimize early.** Ship the slowest, ugliest version that works; iterate later.
4. **No `print`/`console.log` debug shipped.** Real logger from day one (`loguru` for Python, `pino` for JS).
5. **Smoke-test the happy path manually** after each batch, not just automated tests.
6. **Tag the end of every batch**: when the DoD is met, `git tag batch-N-done` and push the tag. These are the known-good rollback anchors.
7. **Externalize magic numbers to config** (see `backend/config.toml`) so tuning never requires a code edit.
8. **Be honest about DoD status.** If part of a Definition of Done can't be met in-session (e.g. it needs a human ear or real recordings), say so plainly in `EDIT_LOG.md` and the PR — never claim it's done.

**Definition of Done for a batch** = the batch's own DoD checklist in
`intempo-combined.md` + all four logs updated + tests green + tag pushed.

## 2. STOP and ask before any UI/UX work

The human owns the look and feel (spec §3.5 is an art-director brief, not
a licence to vibe-code freely). **Before starting any batch that builds
or changes user-facing UI/UX, pause and ask the user before proceeding** —
present the plan and get a go-ahead first. This applies to:

- **Batch 5** — Web frontend foundation
- **Batch 6** — Score capture flow (web)
- **Batch 7** — Recording + analysis flow (web)
- **Batch 8** — Free tier + Stripe + Pro upgrade (has UI)
- **Batch 9** — Native iOS (React Native)
- **Batch 13** — App Store launch + marketing
- …and any later batch, or any change, that touches a screen, component,
  visual style, copy the user sees, or the design system.

Backend / infra / data / pipeline batches (0–4, 10 offline sync core,
11 telemetry, 12 teacher-tier backend) do **not** require this gate —
proceed on those following the procedures in §1.

If in doubt whether something is "UI/UX," ask.

## 3. Batch status (keep this current)

- Batch 0 — Foundations ✅
- Batch 1 — Backend infra (auth, DB, storage) ✅
- Batch 2 — Sheet music OCR pipeline ✅
- Batch 3 — Audio analysis core ✅ (pipeline done; threshold tuning against real recordings still pending — see `TUNING_LOG.md`)
- Batch 4 — Async analysis API + calibration ✅ (BackgroundTasks; Celery migration deferred to §11 triggers)
- Batch 5 — Web frontend foundation ⏳ (shell done: design tokens locked, primitives, routing, auth/data plumbing; build + lint green. Live magic-link auth + E2E test pending Supabase keys — see `EDIT_LOG.md`. Not tagged `batch-5-done` yet.)
- Batch 6 — Score capture flow (web) ⏳ (capture + OCR-review editor + save built, **rebuilt to the locked design system** 2026-07-28; build + lint green. Live upload→OCR→save + iPhone camera pending Supabase keys/device — see `EDIT_LOG.md`. Not tagged `batch-6-done`.)
- Batch 7 — Recording + analysis/verdict flow (web) ⏳ (tempo/calibration/metronome, MediaRecorder panel, polling result screen with verdict/annotated-score/trend/per-note built, **rebuilt to the locked design system** 2026-07-28; build + lint green. Live mic→analysis loop pending mic/Supabase/backend + device — see `EDIT_LOG.md`. Not tagged `batch-7-done`.)
- Batch 8+ — mostly UI/UX → see §2 gate. **Design tokens are locked in `frontend/src/styles/tokens.ts` (manuscript direction) — build to them; see `DECISIONS.md`.**

### Frontend UI rebuild (2026-07-28) — where the screens actually stand

The Batch 5–7 UI was scrapped and rebuilt against `frontend/DESIGN_SYSTEM.md`,
one screen at a time, each verified with a Playwright screenshot of the running
build. Reference mockups live in Figma:
`https://www.figma.com/design/k5IB3714DiusqnAwzkY7pz` (Home / Recording / Verdict).

| Screen | Route | State |
|---|---|---|
| Home | `/` | ✅ rebuilt (greeting, amber CTA, resume card, 2-up library grid) |
| Recording | `/scores/:id/record` | ✅ rebuilt (hero BPM, amber waveform, Deep Spruce surface) |
| Verdict | `/analyses/:id` | ✅ rebuilt (two-tone headline, annotated score, stat chips, tabs) |
| Score capture / OCR | `/scores/new` | ✅ rebuilt (full-bleed, amber pulse, OCR review) |
| Score list | `/scores` | ✅ built (rows, favourite star, empty state) |
| Account | `/account` | ✅ built (identity, plan badge, sign out) |
| Insights | `/insights` | ⏳ still a stub — deliberately held until real analyses exist to design against |

Conventions the rebuild established — **follow these, don't re-litigate them:**

1. **Icons are Phosphor** (`@phosphor-icons/react`). `lucide-react` was removed
   from `package.json` on 2026-07-28 — do not reintroduce it.
2. **Flow screens are full-bleed** with their own `X`-close chrome, routed
   *outside* `<Layout>`. Only tabbed surfaces use `AppShell`. `<Layout>` now
   serves `/showcase` alone.
3. **Motion is Framer Motion** (`motion` package, import from `motion/react`),
   always gated on `useReducedMotion()`.
4. **`/showcase` is the living design-system page** and sources its swatches
   from `styles/tokens.ts` — never re-type hexes into it.
5. Screens still read seed data from `lib/demo.ts` where the live API isn't
   wired. That's deliberate, not a bug — swap it when the endpoints land.

**Honest DoD status:** no batch is tagged `batch-N-done`. Every remaining gate
(live magic-link auth, upload→OCR→save, mic→analysis) is blocked on Supabase
keys and a real device — none of it can be closed in-session, and the screens
are verified *visually*, not end-to-end.
