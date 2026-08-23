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

## 3. Design laws — binding for every UI change

These govern all UI work and outrank any component convention below. They are
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
   typography and spacing first.
7. **Design around the thumb zone.** Primary actions sit comfortably reachable
   near the bottom; secondary actions can sit higher.
8. **Use typography to create hierarchy instead of relying on containers.**
   If a box is doing the work a type scale should do, remove the box.
9. **Bottom navigation is persistent app furniture, not a floating card.**
   Opaque, anchored, unrounded, part of the frame.
10. **Every element must justify its presence.** If removing it makes the
    interface clearer, remove it.

**The three-foot test — run it before writing any UI code, and again on the
screenshot afterwards.** Look at the screen from across the room and name what
you notice first, second and third. If everything competes, the hierarchy is
wrong and the fix is composition, not more styling. Record the answer in
`EDIT_LOG.md` for any screen you build or change.

## 4. Batch status (keep this current)

- Batch 0 — Foundations ✅
- Batch 1 — Backend infra (auth, DB, storage) ✅
- Batch 2 — Sheet music OCR pipeline ✅
- Batch 3 — Audio analysis core ✅ (pipeline done; threshold tuning against real recordings still pending — see `TUNING_LOG.md`)
- Batch 4 — Async analysis API + calibration ✅ (BackgroundTasks; Celery migration deferred to §11 triggers)
- Batch 5 — Web frontend foundation ⏳ (shell done: design tokens locked, primitives, routing, auth/data plumbing; build + lint green. Live magic-link auth + E2E test pending Supabase keys — see `EDIT_LOG.md`. Not tagged `batch-5-done` yet.)
- Batch 6 — Score capture flow (web) ⏳ (capture + OCR-review editor + save built, **rebuilt to the locked design system** 2026-07-28; build + lint green. Live upload→OCR→save + iPhone camera pending Supabase keys/device — see `EDIT_LOG.md`. Not tagged `batch-6-done`.)
- Batch 7 — Recording + analysis/verdict flow (web) ⏳ (tempo/calibration/metronome, MediaRecorder panel, polling result screen with verdict/annotated-score/trend/per-note built, **rebuilt to the locked design system** 2026-07-28; build + lint green. Live mic→analysis loop pending mic/Supabase/backend + device — see `EDIT_LOG.md`. Not tagged `batch-7-done`.)
- Batch 8+ — mostly UI/UX → see the §2 gate and the §3 design laws. **Tokens live in `frontend/src/styles/tokens.ts`; build to them and never re-type hexes.**

### Frontend UI rebuild (2026-07-28) — where the screens actually stand

The Batch 5–7 UI was rebuilt, then **redesigned from the ground up on
2026-07-28** after the rebuilt version still read as AI-generated (excessive
rounded cards, oversized gold surfaces, serif everywhere, a 440px phone column
on desktop). Every screen is verified with a Playwright screenshot of the
running build.

> ⚠️ The Figma file `k5IB3714DiusqnAwzkY7pz` **predates the redesign** and no
> longer matches the app. Treat it as history, not as a spec.

| Screen | Route | State |
|---|---|---|
| Today | `/` | ✅ redesigned (compact prompt, Continue-practicing row, library grid) |
| Library | `/scores` | ✅ redesigned (sheet-crop grid, kind + favourite filters, count) |
| Account | `/account` | ✅ built (identity, plan badge, sign out) |
| Score capture / OCR | `/scores/new` | ⚠️ tokens updated, **layout still the old phone-column composition** |
| Recording | `/scores/:id/record` | ⚠️ same — needs real audio to redesign properly |
| Verdict | `/analyses/:id` | ⚠️ same — needs a real analysis to redesign properly |
| Insights | `/insights` | ⏳ stub, held until real analyses exist to design against |

Conventions the redesign established — **follow these, don't re-litigate them:**

1. **Icons are Phosphor** (`@phosphor-icons/react`). `lucide-react` was removed
   from `package.json` — do not reintroduce it.
2. **Layout is responsive by breakpoint, not one column.** `AppShell` renders
   `layout/TopNav` at `lg`+ over a 1240px container, and `TabBar` below it.
   Never reintroduce a fixed narrow column on desktop. Flow screens stay
   full-bleed with their own `X`-close chrome, outside `AppShell`; `<Layout>`
   serves `/showcase` alone.
3. **Bottom navigation carries destinations only** (Today · Library · Insights ·
   Profile). Actions like "Add piece" live as labelled controls in screen
   headers and the top bar — never as a tab.
4. **Serif is selective**: piece titles and the practice prompt. Section
   headings are small sans labels (`ui/SectionHeading`). Not every heading.
5. **Ochre is an accent, never a surface.** Active states, progress and
   favourites only. Primary actions are ink. No large gold panels.
6. **Structure comes from hairline borders**, not elevation. Radii 8–14px;
   `shadow-card` is nearly invisible and `shadow-lift` is for genuinely
   floating things only.
7. **Sheet music is the visual identity.** Use `sheet/SheetCrop` (deterministic
   SVG engraving) — never abstract placeholder rectangles. Swap for real page
   crops when OCR uploads land.
8. **No developer or demo UI in the product.** The `PreviewBadge` was removed
   for this reason; don't add environment banners to shipped screens.
9. **Motion is Framer Motion** (`motion` package, import from `motion/react`),
   from `lib/motion.ts`, always gated on `useReducedMotion()`. The page
   transition lives inside `AppShell` around the outlet — wrapping `<Routes>`
   unmounts the shell and makes the tab bar blink.
10. **`/showcase` sources its swatches from `styles/tokens.ts`** — never
    re-type hexes into it.
11. Screens read seed data from `lib/demo.ts` where the live API isn't wired.
    Deliberate, not a bug. `title` and `composer` are separate fields; title
    outranks composer in every listing.

### The `mobile/` tree — where transcription actually stands (2026-08-24)

The screen table above describes the legacy `frontend/` tree. The shipping app
is `mobile/` (Expo, also built to web for Cloudflare Pages), and the scan flow
there works differently as of 2026-08-24:

- **Reading a page is asynchronous.** `POST /v1/scores` writes the row and
  returns; `backend/app/workers/transcription_runner.py` fills the notes in.
  The row carries `transcription_status` (`queued` → `reading` → `done` |
  `failed`), the step the worker last reported, and a failure reason written
  for a musician. `usePiece` polls while a scan is unfinished.
- **Progress is measured, never animated toward a guess.** The bar in
  `components/score/TranscribingPanel.tsx` moves when the worker reports a step
  it has reached and at no other time. If you add a pipeline stage, add it to
  `STAGE_PROGRESS` there and to `_HUMAN_STAGES` in the worker — the worker's
  words are the contract between them.
- **Saving a scan lands on `PieceScore`**, which owns all three states
  (reading · failed · done). `ListenButton` lives in `components/score/` and is
  shared by the record, warmup, piece and score screens.
- **`ScoreJson.clef` is nullable.** A score exists before anything has read it.
  Never default it to `treble` to simplify a component — a bass part labelled
  "Treble clef" is worse than no label.
- **Caveats are quiet lines, not badges.** `lib/notation/reading.ts` names the
  bars that don't add up, and confidence is surfaced only when it is *low* and
  with no number in the sentence.
- **A misread bar is fixable, not fatal.** `MeasureEditScreen` corrects
  durations and rests on the measures `validate.py` flags, reached from the
  caveat line on `PieceScore`. Durations and rests only, because they are the
  only things the verdict reads — never widen it to pitch to "make it
  complete".
- **The photograph is deleted only when a person accepts the reading.**
  `POST /v1/scores/:id/accept` is the only thing that discards it, and it
  refuses for a page still being read or one that failed. Never wire discarding
  to `ocr_confidence`, a beat-sum check, or a timer — the pipeline is the thing
  the photograph exists to check, so it cannot be the thing that authorises
  throwing it away.

**Honest DoD status:** no batch is tagged `batch-N-done`. Every remaining gate
(live magic-link auth, upload→OCR→save, mic→analysis) is blocked on Supabase
keys and a real device — none of it can be closed in-session, and the screens
are verified *visually*, not end-to-end.
