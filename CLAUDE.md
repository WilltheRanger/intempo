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

`tools/check-log-entry.py` enforces the `EDIT_LOG.md` row, and CI runs it on
every push and pull request. It exists because a commit landed without its
entry on 2026-08-26 — the script writing the entry failed on a relative path
while the `git commit` beside it succeeded — and nothing noticed. It cannot
check that an entry is *good*; it checks that the change did not go out in
silence.

Three more Python checks run on every push beside it, and a change that trips
one is not merged: `check-brand-assets.py` (a new asset shipping as the Expo
starter's, or a listed one drawn and its line now a false claim),
`check-dead-exports.py` (a named export nothing else in the corpus references)
and `check-migrations.py` (all migrations applied in order to an empty
database). `.github/workflows/ci.yml` is the list that cannot go stale.

**The rest of the operating principles:**

1. **Branch per batch** (`feat/batch-N-...` or the session's assigned branch). Squash to main on DoD.
2. **One fixture file per tricky endpoint** — save the raw response to `fixtures/`, test against it forever. Never call a real LLM/paid API in CI.
3. **Build the best version first.** Not a sketch you intend to replace — the
   version you would defend in review. The shape of the data, the correctness
   of a rule and the composition of a screen are all far cheaper to get right
   now than after something is built on top of them, and a large part of
   `EDIT_LOG.md` is the cost of the other choice. This is **not** licence to
   gold-plate: "best" means the best version *of what was asked for*, not more
   than was asked for. Speed is the one thing still worth leaving alone until
   something is measurably slow — measure, then optimise.
4. **No `print`/`console.log` debug shipped.** Real logger from day one (`loguru` for Python, `pino` for JS).
   Enforced in `mobile/` since 2026-09-03 (`no-console`, error). Two lines are
   exempt with a written reason: `App.tsx`'s boot line naming whether the build
   is on fixtures, and `ErrorBoundary.componentDidCatch` — the only record a
   crash leaves. **The app had no linter at all until then**, while six files
   carried `eslint-disable` directives for one; `react-hooks/rules-of-hooks` is
   the rule it was worth installing for, since a hook below an early return is
   React error #310, which this project has shipped and which compiles,
   typechecks and passes its tests. Rules and the three scoped exceptions are in
   `DECISIONS.md`, 2026-09-03. `frontend/` has its own config and CI lints
   neither it nor, before now, the product.
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

## 3. Design laws — binding for every UI change

These govern all UI work and outrank any component convention in
`docs/subsystems.md`. They are
the user's rules, not suggestions to weigh against convenience.

1. **Design a native mobile product, not a responsive website shrunk onto a
   phone.** Mobile is the primary target; desktop is an adaptation of it, not
   the other way round.
2. **Prioritise hierarchy, spatial rhythm, thumb reach and content flow** over
   decorative components.
3. **Do not turn every section into a card.** The background is a compositional
   surface. Cards are reserved for information that genuinely needs grouping.
4. **One dominant focal point per screen.** Secondary information must visually
   recede. Two competing focal points means the hierarchy is wrong.
5. **Consistent horizontal margins and a deliberate vertical spacing system.**
   Spacing is a system, not a per-component guess.
6. **Rounded containers, pills, gradients, shadows, borders and floating
   elements are exceptions, not the default styling language.** Reach for
   typography and spacing first. **The control layer is the one exception**
   (amended 2026-09-06): navigation, toolbars, buttons and floating panels are
   floating glass capsules — `mobile/src/components/primitives/GlassSurface`.
   That list *is* the definition of chrome for this rule; content keeps the rule
   in full and may never use the material.
7. **Design around the thumb zone.** Primary actions sit comfortably reachable
   near the bottom; secondary actions can sit higher.
8. **Use typography to create hierarchy instead of relying on containers.**
   If a box is doing the work a type scale should do, remove the box.
9. **Bottom navigation is persistent app furniture — and it floats.**
   Amended 2026-09-06, reversing "not a floating card. Opaque, anchored,
   unrounded, part of the frame." It is a translucent capsule inset from the
   edges with content scrolling beneath it. *Furniture* still governs the rest:
   it does **not** resize on scroll, and it carries **no** selection pill — both
   were prototyped and rejected. See `DECISIONS.md`, 2026-09-06.
10. **Every element must justify its presence.** If removing it makes the
    interface clearer, remove it.

**Screen rules live in modules, not components.** There is no React Native
testing library here (`DECISIONS.md`, 2026-08-24), so a rule inside a `.tsx` is
a rule nothing checks. Put the rule in a module with tests and let the component
call it. This is filed under the capture path in `docs/subsystems.md` because
that is where it was learned, but it applies to every screen.

**The three-foot test — run it before writing any UI code, and again on the
screenshot afterwards.** Look at the screen from across the room and name what
you notice first, second and third. If everything competes, the hierarchy is
wrong and the fix is composition, not more styling. Record the answer in
`EDIT_LOG.md` for any screen you build or change.

## 4. Batch status (keep this current)

**The shipping app is `mobile/`** — Expo, also built to web for Cloudflare
Pages. `frontend/` is the legacy Vite tree that batches 5–7 below describe; it
is history, not a spec, and its conventions are in `docs/subsystems.md` under
that warning. Batches 5–7 say "(web)" for that reason.

- Batch 0 — Foundations ✅
- Batch 1 — Backend infra (auth, DB, storage) ✅
- Batch 2 — Sheet music OCR pipeline ✅
- Batch 3 — Audio analysis core ✅ (pipeline done; threshold tuning against real recordings still pending — see `TUNING_LOG.md`)
- Batch 4 — Async analysis API + calibration ✅ (BackgroundTasks; Celery migration deferred to spec §11 triggers)
- Batch 5 — Web frontend foundation ⏳ (shell done: design tokens locked, primitives, routing, auth/data plumbing; build + lint green. Live magic-link auth + E2E test pending Supabase keys — see `EDIT_LOG.md`. Not tagged `batch-5-done` yet.)
- Batch 6 — Score capture flow (web) ⏳ (capture + OCR-review editor + save built, **rebuilt to the locked design system** 2026-07-28; build + lint green. Live upload→OCR→save + iPhone camera pending Supabase keys/device — see `EDIT_LOG.md`. Not tagged `batch-6-done`.)
- Batch 7 — Recording + analysis/verdict flow (web) ⏳ (tempo/calibration/metronome, MediaRecorder panel, polling result screen with verdict/annotated-score/trend/per-note built, **rebuilt to the locked design system** 2026-07-28; build + lint green. Live mic→analysis loop pending mic/Supabase/backend + device — see `EDIT_LOG.md`. Not tagged `batch-7-done`.)
- Batch 8+ — mostly UI/UX → see the §2 gate and the §3 design laws. **Build to
  the tokens and never re-type hexes** — `mobile/src/design/` for the shipping
  app, `frontend/src/styles/tokens.ts` for the legacy tree. This line named
  only the second for a long time, and the two palettes share **no colour but
  white** (measured 2026-09-02), so following it while working in `mobile/`
  builds a screen in the wrong palette.

**Honest DoD status.** `git tag` is the answer. Batches **0, 1 and 2 are tagged
and pushed**; **3 and 4 are marked ✅ and are not tagged**, so by this file's own
Definition of Done they are not done; 5 onward are ⏳. Every remaining gate
(live magic-link auth, upload→OCR→save, mic→analysis) is blocked on Supabase
keys and a real device — none of it can be closed in-session, and the screens
are verified *visually*, not end-to-end.

## 5. Before you work on a subsystem, read its section

`docs/subsystems.md` holds what was learned the hard way about five parts of
this codebase: the `mobile/` tree and transcription, the capture path, the
recording path, the API's concurrency, and the legacy `frontend/` tree.

**Read the one section you are about to touch — not the file.** It is ~10,600
words of post-mortem, and it used to sit here, loaded in full at the start of
every session before any work began. That cost a large share of every context
window to deliver, on most turns, nothing relevant; and it made the ~1,450 words
of actual rules above harder to find, which is a failure mode this project has
already paid for at least once — a session read the `frontend/` conventions as
binding for the shipping app, which the archive itself warns against.

Everything in it is still true and still worth reading; none of it was deleted
in the move. It is a reference, not a preamble.

**A comment citing `CLAUDE.md` for a subsystem rule means
`docs/subsystems.md`.** Roughly fifteen comments and test docstrings across the
repository — `tools/`, `backend/`, `mobile/src/`, `.github/workflows/` — cite
this file for rules that moved on 2026-09-06. They were deliberately not
rewritten: touching fifteen files to fix a pointer is how a documentation change
becomes a diff nobody reviews.

**When you learn something the hard way, it goes in `docs/subsystems.md`** —
under the subsystem it belongs to. A rule belongs *here* only if it changes what
a session does before it knows which subsystem it is touching.
