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
- Batch 5 — Web frontend foundation ⏳ (next) → **UI/UX — STOP and ask before starting (see §2)**
- Batch 6+ — mostly UI/UX → see §2 gate
