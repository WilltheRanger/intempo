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
- Batch 8+ — mostly UI/UX → see the §2 gate and the §3 design laws. **Build to
  the tokens and never re-type hexes** — `mobile/src/design/` for the shipping
  app, `frontend/src/styles/tokens.ts` for the legacy tree. This line named
  only the second for a long time, and the two palettes share **no colour but
  white** (measured 2026-09-02), so following it while working in `mobile/`
  builds a screen in the wrong palette.

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

Conventions the redesign established — **follow these, don't re-litigate them.**

> **Which tree these describe.** The list below was written for `frontend/`, and
> its *design* decisions carry to `mobile/` unchanged — ochre as an accent and
> never a surface, structure from hairline borders, serif used selectively,
> sheet music as the visual identity, no developer or demo UI. Its *pointers* do
> not, and a session following them literally in the shipping app would undo
> working code. Measured 2026-09-02:
>
> | Convention says | `mobile/` actually uses |
> |---|---|
> | Icons are Phosphor; `lucide` was removed, do not reintroduce it | `lucide-react-native` throughout — no Phosphor package at all |
> | `AppShell` with `layout/TopNav` at `lg`+ over a 1240px container | its own navigator; `ScreenContainer` and a tab bar |
> | Motion is Framer Motion, imported from `motion/react` | React Native animation (`PressableScale`, `Animated`); neither `motion` nor `framer-motion` is a dependency |
> | `/showcase` sources its swatches from `styles/tokens.ts` | there is no `/showcase` route |
> | Screens read seed data from `lib/demo.ts` | `data/sources/fixtures.ts` |
>
> The caveat further down — *"The screen table above describes the legacy
> `frontend/` tree"* — is attached to the table and is about transcription. This
> list sits between the two and reads as binding for all UI work, which is how
> it stayed wrong.

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
7b. **`staveScoreFor` drops what it cannot draw rather than rounding it** — a
   sixteenth drawn as an eighth is a rhythmically wrong line of music presented
   as a right one — and the screen says how many it left out. As of 2026-09-01
   the engraver draws **42 of the schema's 46 durations**: whole through
   sixty-fourth and the breve, single and double dots, rests at every one of
   those values, and the triplet/quintuplet/septuplet forms. What it refuses is
   the 128th family, named in `DELIBERATELY_UNDRAWN` — five beams at this stave
   size is a smudge, and a counted omission beats an illegible mark presented as
   a reading.
   **Measure against the schema, never against the corpus.**
   `tools/engraver-coverage.py` reported **100% of every fixture** while four
   values had no glyph at all, because not one page in the repository contains a
   note shorter than a sixteenth — and it once reported 5% missing and a worst
   page of 67% while the first real orchestral part photographed scored **0%**
   and rendered as a title and a photograph. The corpus is pages somebody chose
   to check something with. The tool prints both tables now;
   `notation/durations.test.ts` holds the schema side.
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
- **Progress is measured, never animated toward a guess.** The bar moves when
  the worker reports a step it has reached and at no other time.
  `fixtures/stages/parity.json` is the contract; `lib/transcriptionProgress.ts`
  holds the app's side (out of the component so the rules can be tested) and
  `_HUMAN_STAGES` / `_human_stage` the worker's. Adding a pipeline stage means
  editing the fixture **and** both sides —
  `backend/app/tests/test_stage_parity.py` and
  `transcriptionProgress.test.ts` fail otherwise.
  **"In both directions" was three of four** (measured 2026-09-03). A stage
  added to the fixture failed two tests on each side; a stage added to
  `STAGE_PROGRESS` failed the app's. A stage added to `_HUMAN_STAGES` passed
  all ten, because `test_the_worker_says_exactly_the_static_words_the_fixture_
  lists` builds its expected set from four hand-written `_human_stage` calls
  rather than from the worker's own table. The cost was not a crash: the app
  **holds** the bar on a stage it does not recognise, so a new stage with no
  fixture entry stopped the bar for exactly as long as that stage took — the
  measured-progress promise weakening quietly rather than breaking.
  `test_every_stage_the_worker_can_name_is_in_the_contract` reads
  `_HUMAN_STAGES` and closes it.
  Three rules that each exist because they were once broken: a stage this build
  does not recognise **holds** the bar (falling back threw a read at 70% down to
  5%); positions increase in the order the worker reaches them; and the reading
  band ends exactly where "Reading the notation" sits, so a stave-by-stave page
  that falls back to being read whole does not retreat.
  A stave count (`Reading stave 3 of 7`) is measured progress and is shown; the
  provider's name never is.
- **Saving a scan lands on `PieceScore`**, which owns all three states
  (reading · failed · done). `ListenButton` lives in `components/score/` and is
  shared by the record, warmup, piece and score screens.
- **`ScoreJson.clef` is nullable.** A score exists before anything has read it.
  Never default it to `treble` to simplify a component — a bass part labelled
  "Treble clef" is worse than no label.
- **Caveats are quiet lines, not badges.** `lib/notation/reading.ts` names the
  bars that don't add up, and confidence is surfaced only when it is *low* and
  with no number in the sentence.
- **A piece can also arrive as a file.** `ImportFileScreen` reads MusicXML,
  unzipping `.mxl` in `lib/musicxml/file.ts` (magic bytes, not extension). It
  is the only route where the durations are *stated* rather than read, so it is
  the one whose timeline cannot be wrong. A multi-part file asks which part you
  play and shows the answer afterwards — never guess it, and never infer the
  instrument from the clef: a cello reads bass clef too.
- **The analysis knows what you play.** `submitTake` sends the `Instrument`
  preference; `analyses.instrument` stores it; `analysis_runner` turns it into
  `analyze(..., double_bass=...)`. Store the instrument, never a derived flag —
  how each instrument should be treated is still being tuned.
- **`app.json` is the one place a token has to be re-typed, so it is checked**
  (2026-09-03). It is JSON and cannot import `design/colors.ts`, and its two
  colours had already drifted: `expo.backgroundColor` and the Android adaptive
  icon read `#FBFAF7` against a `colors.bg` of `#F7F2E9` — close enough that
  nobody would see it side by side, far enough to be a flash of the wrong paper
  on launch. Nothing checked it, while `scripts/flatten-vendor-assets.mjs`
  checked the *web* build's background against the same token and printed the
  result: the one surface with a check was the one that is not the shipping app.
  `design/appConfig.test.ts` holds both now. These are colours the operating
  system paints — the root view on launch and behind an over-scroll bounce, and
  the plate a launcher draws the icon on — so they appear before any component
  mounts and no screenshot of a screen can catch them.
  `expo.backgroundColor` also needs **`expo-system-ui` installed** to reach iOS
  at all; without it `expo prebuild` warns and drops it, so the wrong colour was
  not being applied either. Measured after: `RCTRootViewBackgroundColor` =
  `0xFFF7F2E9`.
- **CI builds the iOS bundle, not just the web one** (2026-09-03). Every other
  check in this repository — the walk, the a11y audit, every screenshot in
  `EDIT_LOG.md` — runs through the **web** bundle, and the two module graphs are
  not the same: `.web.ts` resolves to a native sibling, `Platform.OS` folds the
  other way, and a `document.` outside a guard is invisible until a phone runs
  it. `expo export --platform ios` resolves the native graph and Hermes
  compiles it. Measured on the bytecode: `intempo-listen-` (the native player's
  WAV name) present, `AudioContext` and `createMediaStreamDestination` absent,
  `beforeunload` stripped with its guarded branch. It proves the bundle
  **builds**, never that it **behaves** — nothing here has made a sound.
- **The app can be built for a device** (2026-09-03). `ios.bundleIdentifier`
  and `android.package` are `com.intempo.app`, and `eas.json` holds the
  profiles; without them `expo prebuild` and EAS cannot run, so there was no
  route onto a phone at all. The identifier is changeable until the first
  submission and permanent after it. **No build has been produced** — no macOS,
  no Apple account, no EAS credentials here — and `mobile/README.md` lists the
  three things that still need a person. There is deliberately no `development`
  profile: it requires `expo-dev-client`, which is not a dependency, so it would
  be config that fails on first use.

- **The verdict feedback loop has a client** (2026-09-03). A revealed measure
  on `VerdictScreen` asks *"What actually happened?"* and posts to
  `/v1/analyses/:id/corrections`, which had never been called. `canCorrect` is
  the row's own `revealsFigure` — one predicate, so the question cannot appear
  on a bar the pipeline refused to judge — and the app's own reading is
  pre-selected, because agreement is the control group and a form that collects
  only disagreement measures the wrong thing. Rules in `lib/verdict/
  correction.ts`, not in the `.tsx`.
- **One finished endpoint has no client, and a test stops a second**
  (measured 2026-09-03). `POST /v1/analyses/:id/corrections` is
  built, tested (`test_corrections.py`), owner-scoped, listed by the account
  export and taken by account deletion. **Nothing posts to it.** Not `mobile/`,
  not `frontend/`; the verdict screen has no "this wasn't right" affordance at
  all, so `verdict_corrections` is empty for every account by construction.
  This is not the same thing as the *reading* corrections, which do work:
  `MeasureEditScreen` → `scores.py` → `services/training.py`, consent-gated by
  migration 013, and that is what the Profile toggle and the privacy copy are
  about. The two are easy to conflate because both are called "corrections".
  It matters because of what the router's own docstring claims: the loop is
  *"the only route out of the position Batch 3 is currently stuck in"* —
  thresholds still on the spec's starting values because tuning needs real ears
  on real recordings. An empty table cannot tune anything, so the state
  `TUNING_LOG.md` records as pending has no mechanism behind it. Building the
  affordance is a §2 gate; leaving the gap unwritten is how it survived this
  long.
  **`POST /v1/calibration` is the second** (spec §4, infer a target BPM from a
  short clip). `bpm_source` carries `calibration_clip` for it, and
  `submitTake.ts` described that flow *in the present tense* while sending
  `manual` every time.
  `test_client_reachability.py` is the standing check, and it runs **both
  ways**: every served `/v1` route must have a client, and every `/v1` URL the
  app builds must be a route this API serves. The second is the one a musician
  feels — a client with no route is a 404 in their hands, from a path mistyped
  or renamed on one side only, and nothing else here would catch it because
  there is no integration test against a running server. Paths only, since the
  method sits in the fetch options rather than beside the URL. Its `NOT_WIRED` list is held **in both directions** — an entry
  for a route the app has since started calling fails, and so does an entry for
  a route that no longer exists — because an exclusion list whose reasons rot is
  precisely what the timeline parity fixture was, one bullet up.
- **A key printed mid-piece is a change of key** (2026-09-02).
  `Measure.key_signature` is the third field of the `time_signature` / `clef`
  shape and obeys the same rule: printed on one bar, holding until the next bar
  prints one. `ScoreJson.key_signature` stays the key the page **opens** in.
  Compared **by signature** (`key_fifths` / `accidentalCount`), never by name —
  `Bb major` and `G minor` are the same two flats — and against the key **in
  force**, never against the header, or a part that returns to its opening key
  records the departure and drops the return. That last bug was live in the
  *metre* and fixed alongside it.
  The engraver draws the new signature after the barline, opens each later
  system's head in the key then in force, and prints a **courtesy** at the end
  of the line before a change that opens the next one — without which a change
  to C major is announced by nothing, since its head prints no accidentals. A
  change *to* a key with no accidentals is the one case that cancels the old
  signature with naturals; every other change prints only its own marks.
  `packSystems` reserves the courtesy **one bar ahead**: charging it to the
  previous bar unconditionally makes the line break, and the break is what
  creates the courtesy it was paying for.
  `what_this_piece_is` names the key **at the bars being re-read**, and names
  none when they straddle a change — a corrector prompt that states the wrong
  key gets back a bar that sums perfectly and is spelled a semitone off.
- **A repeat can open on one page and close on another** (2026-09-02). Most
  pieces that repeat their opening print no `|:` at all, so a backward sign
  with nothing to pair it with falls back to the start of what was read — right
  for a piece, wrong for a *page*. Read alone, page 3 of a part reported a
  repeat starting at page 3's first bar; measured, a `|:` on page 1 bar 5
  closing on page 3 bar 4 read as **4** bars repeated where the truth is 20.
  Two facts carry across the join and neither can be inferred later:
  `ScoreJson.unclosed_repeat_starts` (the forward signs still open where a
  page's music stopped — a **stack**, because nested `|:` is legal and losing
  the outer one is the same bug a level down) and `Repeat.start_inferred`
  (whether the opening was printed or fallen back to). `join_pages` rewrites
  **only** the inferred ones. That second field is what makes it safe: a repeat
  whose `|:` was genuinely printed on a page's first bar is an ordinary section
  boundary and is left exactly alone, which is why dropping such repeats — the
  other candidate fix — would have traded this bug for a worse one. Both
  default to "no information", so every stored score reads back unchanged.
  This was a strict `xfail` for a week whose reason said *"multi-page is inert
  behind the unapplied 011, so nothing reads this today"* — 011 went live on
  2026-08-29 and nobody re-read the note, so a live defect looked parked.
  **A reason to postpone is a claim, and it goes stale like any other.**
- **A clef printed mid-piece is a change of clef** (2026-09-02).
  `Measure.clef` is the fourth field of the `time_signature` / `key_signature`
  shape and obeys the same rule; `ScoreJson.clef` stays the clef the page
  **opens** in. Compared against the clef **in force**, never the header, or a
  part returning to bass at bar 40 records the departure and drops the return.
  `staveScoreFor` marks the item opening a changed bar; `layoutSystem`'s
  `middleStep` is a **running** value updated *before* that item is placed,
  because a clef printed at a bar governs that bar's first note too. A system
  starting after a change opens its head in the new clef and does not repeat
  it; a change mid-system is drawn small (`CLEF_CHANGE_SCALE`) and
  right-aligned against the notehead it governs — anchored to the **note**, not
  the barline, because a clef change is legal without one.
  **`EngravedHead.clef` carries which clef it is**, not just a position: the
  renderer used to draw `CLEF_GLYPH[clef]` from its own prop, which the moment
  a later system could open in a different clef would have drawn the opening
  sign at the new clef's line — invisible to any test checking geometry rather
  than glyphs.
  `fixture-clef-change-study` is the fixture; without one this was a state
  nobody had looked at, which is how it stayed broken.
- **A misread bar is fixable, not fatal.** `MeasureEditScreen` corrects
  durations, rests, **pitch** (stepping by letter, with a separate accidental
  control) and adds or deletes notes. Reached two ways from `PieceScore`: the
  caveat line for the bars `validate.py` flags, and a picker over *every*
  measure — because two compensating errors in one bar sum correctly and are
  invisible to the beat check.
  This entry used to say "durations and rests only … never widen it to pitch".
  Pitch shipped, and the reasoning had changed with it: the verdict reads
  `pitch` only as `== "rest"`, but a **tie** is now validated by whether two
  noteheads share a pitch, so a wrong pitch can delete an onset. Correcting it
  is repairing the timeline, not decoration.
- **`MeasureConcern.kind` names the branch that wrote the sentence** — and one
  branch had no name (2026-09-03). `_concerns_for`'s ladder ended in an `else`
  returning `"beats"`, so `out_of_line`, added later, fell through it. The app
  prints `detail` verbatim for every kind **except** `"beats"`, which is the
  one wording allowed to promise arithmetic — it becomes *"doesn't add up to
  the time signature"*. And `out_of_line` is set **only where no metre could be
  read**, so a bar flagged for being out of step with its page was described to
  a musician as disagreeing with a time signature the server had just said it
  could not find. The true sentence was sitting in `detail` the whole time.
  It has a kind now (`adrift`), and `_concern_kind` is extracted so the mapping
  can be exercised one fault at a time:
  `test_every_fault_a_measure_can_carry_has_its_own_concern_kind` reads
  `MeasureFinding`'s fields, so a *new* flag with no branch fails instead of
  quietly becoming arithmetic. Do **not** replace the `else` with a default
  again; an unmapped fault is not an unreported one, it is a misreported one.
  `test_a_new_concern_kind_would_still_reach_the_musician` holds the other
  half — the app names `'beats'` and nothing else, which is what lets a new
  server-side check reach the screen with no client change.

- **Six things flag a measure, and only one of them is arithmetic.** Beat sums
  (`verdict`), plus five separate fields on `MeasureFinding`: `broken_ties`,
  `tuplet_faults`, `too_dense`, `unwritable_notes` and `out_of_line`. The five
  all exist because a measure can sum to **exactly** the right number of beats
  and still be wrong — a slur written as a tie, a 5:4 bracket approximated as
  triplets, a tremolo read as sixteen sixteenths. Keep them separate from
  `verdict`; collapsing them lets a clean beat sum hide them.
  **This line said "four" and named three** (2026-09-03): `unwritable_notes`
  and `out_of_line` arrived later and nobody came back. The count is not
  written down anywhere now — `test_the_cases_exercise_every_flag_there_is`
  reads the dataclass and fails when a sixth appears with no case, which is the
  only version of this sentence that cannot go stale again.
- **The validator has one home and two ports**, and they must agree:
  `ocr/validate.py`, plus `tools/validator-sandbox.template.html` and
  `tools/scan-bench.template.html`. `test_sandbox_parity.py` is the only thing
  holding them together — when you add a check, port it and add a case, or the
  browser tools will quietly call a bad page clean.
  It compares **which flag fired**, not just that one did (2026-09-03). It used
  to compare `verdict` and `is_problem`, and `is_problem` is true for any of the
  six — so a port that flagged the right bar for the *wrong reason* matched on
  every field the test looked at, and the sandbox would mark a page for a fault
  it does not have. Measured when the assertion went in: all three copies agreed
  on every flag, on all 44 cases. Nothing was broken; nothing was holding it.
- **The timeline has two walks and one contract, and an exclusion needs a
  reason that is still true.** `alignment.build_timeline` builds what the
  analysis expects to hear; `lib/score/schedule.ts` builds what the app plays.
  `fixtures/timeline/parity.json` holds both the onset times **and**
  `expected_measures`, the performed order — because two bars of equal length
  swapped give the same times, and the performed order is what
  `measuresInPlayOrder` (a hand port of `expand_repeats`) can get wrong.
  Its `excluded_on_purpose` field is the dangerous part: it listed repeats,
  saying playback plays straight through, which stopped being true the day
  `scheduleScore` started expanding them — and a test *asserted* the exclusion,
  so the one piece of arithmetic most likely to drift could not be covered
  without first disbelieving the file. **Slurs are the only real difference**
  (the server emits no onset under a bow stroke; playback sounds it). Before
  adding to that list, measure both walks on the same score; before trusting a
  line already on it, measure again.

- **The app does not have a fourth copy, and must not grow one.** It reads
  `ScoreResponse.concerns`, which the server computes. It had its own beat-sum
  check, which was fine while beat sums were the only test — then three checks
  arrived that fire on measures whose beats add up *exactly*, and the app went
  silent on all of them. `notation/reading.ts` keeps a local beat-sum check for
  live editing and as a fallback for an older backend; it is a subset on
  purpose. Add a check to `validate.py`, not to the app.
- **A page is read by `homr` first, and by the vision models behind it.** homr is
  an OMR engine — it segments the page, finds the staves, **dewarps each one**,
  and emits MusicXML, which `musicxml.py` has imported since Batch 2. On the one
  real page measured: 74 measures and 267 notes with 73 of 74 bars adding up,
  against the vision chain's 59 and 112. Dewarping is why, and it is not
  something a prompt can fix.
  It is a **provider** in the same registry as the models, declaring
  `reads_whole_page = True` — so it is handed the page, never a crop, because
  its own staff-finding is better than the crops here and that is the reason to
  run it. A confident reading from it is the answer; a doubtful one is kept
  while the models take their turn on crops, and returned only if nothing
  betters it. Its `ocr_confidence` is the **share of bars that add up**, computed
  here — the importer's number is conversion loss and reads 1.0 on real output,
  which would claim certainty about a photograph.
  **A multi-bar rest is expanded into the bars it stands for** — `musicxml.py`,
  `_expand_multiple_rests`. `<multiple-rest>4</multiple-rest>` arrives as *one*
  empty `<measure>`, and read literally three bars of time vanish; since
  `alignment.py` accumulates durations, every bar after the rest is then judged
  eight beats early, so a musician who counts the rest correctly is told they
  rushed the rest of the page. It is a second pass because the bar length is
  often not knowable yet — the real page's only `<time>` is printed mid-page —
  and it falls back to `infer_beats_per_measure`, **asked rather than copied**.
  A metre no single rest fills (5/4, 7/8, none at all) leaves the bar visibly
  empty rather than inventing a duration. Renumbering happens only when
  something was expanded. Measured: `homr_page.jpg` 74→77 bars at 1.00,
  `page-upright.jpg` 43→51 bars at 0.70→0.86.
  **A whole rest alone in a bar is a bar of rest, whatever the metre says** —
  `_whole_rests_that_mean_a_bar`. An engraver writes the whole-rest glyph for a
  full bar in any metre, so homr's literal four quarter-beats runs a 2/4 bar two
  beats long and, since durations accumulate, judges every later bar late. Three
  limits, each of which is the rule doing harm if removed: exactly one note in
  the bar, that note a **rest** (a lone whole *note* rewritten as silence
  deletes music), and the bar shorter than a whole note. Such a bar also gets
  **no vote** in `infer_beats_per_measure` — its length is the question being
  asked. Measured: `page-upright.jpg` 0.86→0.98, corpus mean 0.81→1.00.
  **It does not quantise, and that is measured rather than hoped** (2026-08-26).
  The worry was that a page of nothing but quarters is what both a march and a
  rounding look like, and the beat check cannot separate them. Two fixtures can,
  because `SOURCES.md` documents what is printed on them: `01_simple_printed`
  (Wohlfahrt No. 1, continuous eighths) reads back **32 eighths and nothing
  else**, and `03_complex_printed` (Kreutzer No. 2, continuous sixteenths) reads
  back **48 sixteenths and nothing else**. `tools/homr-bench.py` prints the
  duration mix per page, so the check is one command rather than an argument.
  It runs **only on Modal** (`transcribe_score`): 1350 MB peak, measured, on a
  512 MB host. `TRANSCRIPTION_RUNTIME=modal` sends pages there and is separate
  from `ANALYSIS_RUNTIME` on purpose. AGPL-3.0, used unmodified, accepted
  deliberately by the owner.
- **Staff systems are found by ink density, not by darkness, and the crops tile
  the page.** Both were rewritten after the first real photograph this project
  has seen — a String Bass part with ten systems — where the old projection of
  "rows that are mostly dark are staff lines" found **two**. A page held in the
  hand is not flat: each system slopes by more than its own height across the
  width, so no row is mostly anything, and no rotation fixes it because every
  system slopes differently. `_ink_profile` measures each pixel against the
  paper immediately around it and smooths by a fraction of the page **width**
  (height would depend on how many systems are on the page — a single-staff
  strip then returns its five lines as five bands). That page now gives its ten
  systems plus the desk above and below.
  `crop_systems` **tiles**: every row belongs to a crop, boundaries at the
  quietest row between bands. Cropping the bands and discarding the rest is how
  that page lost eight systems silently, and padded bands still hold only 85% of
  its ink. The overlap comes from the *median* band, never each band's own height
  — the desk band is three times a system tall and padding from it made the last
  system appear in two crops.
  `_cuts_are_quiet` is the remaining guard: a cut through a system splits a bar
  between two crops. `NoMusicFound` lets the first and last crop hold no music,
  because they cover the page's margin; an interior one may not.
  Do not fit these constants to one photograph — the measured passing range, and
  the tidier pocket I declined to take, are in `EDIT_LOG.md`, 2026-09-17.
- **The chain is `homr` and nothing else** (owner's call, 2026-08-24: *"run
  homr only, no backup AI"*). The vision models were the backup and they were
  what invented notes. They stay in `PROVIDER_REGISTRY`, so a deployment turns
  them back on with one variable — do not delete them, because the decision
  being reversible is part of why it was safe to make. The cost is real: homr
  lives only in the Modal container, so the API host can read nothing, and
  `_read_page` refuses **before downloading the page** rather than paying for
  megabytes to reach a worse error. "homr is not installed in this container"
  matches no `_FAILURE_REASONS` needle and lands on *"a flatter, better-lit
  shot of the page usually fixes it"* — a server fault blamed on the musician,
  for the third time.
- **The boot watchdog must never fire over a mounted app.** It reported *"The
  app crashed while starting. / unknown error"* for a **dropped image request**
  — `expo-image` and react-native-web both mount real `<img>` elements, a
  resource error is a plain `Event` with no `.message`, and `report()` replaced
  `#root`'s `display:flex; height:100%; flex:1` with `display:block`, collapsing
  the running app to zero height. Measured before/after: app container height
  `0` → `844`. Resource failures are now collected and named, never latched;
  `report()` returns early once `#root` has children. If you touch
  `public/index.html`, `src/lib/bootWatchdog.test.ts` evaluates that IIFE
  against a DOM stub.
- **A page too small to read is refused, not read.** `staff_space_px` measures
  staff-line spacing from the autocorrelation of the ink profile in each band;
  `too_small_to_read` refuses under **8 source pixels**, and refuses when no
  band yields a staff period at all. Checked before any provider sees the page
  and on the photograph as downloaded, never the prepared copy — the crops are
  cut from the photograph, so the prepared page understates what the reader
  gets. This exists because a webcam capture at 480×640 passed every stage:
  the systems were found, all eight were cropped and sent, and a reading came
  back at 0.40 confidence describing itself as "approximate reconstructions",
  which the app drew as a score. Every mechanism for doubt fired and none
  helped, because they all say *this reading might be wrong* when the true
  statement is *there was nothing here to read*. Three rules inside it each
  exist because removing them flips a real page from refused to read: a band
  may not report a staff taller than itself (the real page reports a confident
  28 px without that cap); the statistic is the **25th percentile**, because
  autocorrelation peaks only at *multiples* so harmonics bias any average
  upward, while the strict minimum lets one cue staff veto a good page; and a
  period under 3 rows is halftone, not a staff. Do not refit the floor to one
  photograph — the two measurement series are in `EDIT_LOG.md`, 2026-08-24.
- **Anything Modal turns into gRPC metadata must be stripped.**
  `clean_modal_credentials()` trims the token before either spawn builds a
  client. A newline in `MODAL_TOKEN_ID` made `fn.spawn()` raise from six frames
  down on **every** call, so no page ever reached Modal — the only place homr
  is installed — and pages were read by the vision chain alone for as long as
  nobody looked. `/v1/ready` reported the credentials fine throughout, because
  it tested them for presence and a value ending in `\n` is present.
- **A configuration check is not a behaviour check.** Every readiness check
  passed while every spawn raised, because they asked whether Modal *could* be
  reached, not what happened when a page was actually handed over.
  `dispatch.transcription_dispatches` counts pages sent against pages read
  here, and `/v1/ready` reports the ratio — so a deployment that has never once
  used the runtime it is configured for says so on the first scan instead of
  after a page of invented notes. It keeps the failure **type** and never the
  message: `grpclib` puts the credential in the message, and a readiness detail
  is served over HTTP.
- **Deleting a piece deletes its photograph too.** `delete_score` removed the
  row and left the object, and the only storage deletion is reached from
  `POST /:id/accept` keyed off an existing row — so the object then had no row,
  no accept path and no delete path, forever. Two orderings hold it together:
  the key is read **before** the row goes (the row is the only thing that knows
  it), and the object is removed strictly after the delete **succeeded**, never
  merely after it ran — a select that finds a row and a delete that matches
  none must not cost a photograph. Storage being down never blocks the delete.
- **The photograph is deleted only when a person accepts the reading.**
  `POST /v1/scores/:id/accept` is the only thing that discards it, and it
  refuses for a page still being read or one that failed. Never wire discarding
  to `ocr_confidence`, a beat-sum check, or a timer — the pipeline is the thing
  the photograph exists to check, so it cannot be the thing that authorises
  throwing it away.

- **Taking your data out means a file, and only when it left the app**
  (2026-09-03). `saveAccountExport` shared the JSON as a `message` on native —
  which on iOS is a *string*, so the sheet offered Messages and Mail, never
  "Save to Files", and RN's `title` being Android-only meant the filename it
  computed was thrown away. It writes a file with `expo-file-system` and shares
  `url` **alone**: a sheet handed `url` and `message` together offers some
  destinations the text, which is the same defect in half the sheet. Android
  still shares text because RN ignores `url` there — the comment names the line
  to change when Android ships. And `Share.share` **resolves for a dismissal**,
  so the function answers whether the export left the app; the screen said
  "Your export is ready" to everyone who opened the sheet and changed their
  mind. One export sits in the cache at a time — it is the musician's data in
  the clear — and the *current* one is deliberately not deleted when the sheet
  closes, because the destination copies it during the activity.
  `fetchAccountExport` also carries the sample-data guard its five neighbours
  carry: without it, it was the one call in the app that reached `apiFetch`
  with no token and told a musician **"Your session has ended. Sign in
  again."** on a build where every other screen has them signed in.

- **A generated file with no check drifts, and this one is a legal notice**
  (2026-09-03). `src/data/licences.ts` says at the top that it is generated and
  must be regenerated after a dependency change, and `expo-system-ui` was
  missing from it — the most recently added dependency, absent from the page a
  user reads in the shipped app, with nothing failing. `licences.test.ts` holds
  both directions against `package.json`, which is also what keeps the two
  vendored lists (generator and test) in step without anyone remembering.
  The generator now **throws** on a package it cannot read: it used to `catch`
  and drop it, so running it against a partial install silently *deleted*
  attributions and printed a success line — the same outcome as never running
  it, with a commit behind it.

- **A signed mean answers "which way", never "how much"** (2026-09-02). Insights
  summarised thirty days with one, so a musician 18% ahead in one bar and 18%
  behind in the next averaged to **zero** — and the headline's band and
  direction were not read off that mean at all but **borrowed from one take**,
  whichever sat nearest it. Two takes 15% either side of the beat therefore
  read "You tend to drag" or "You tend to rush" **depending on the order the
  server returned them in**, over a bar sitting dead centre. `spreadPct` is the
  companion: mean **distance** from the beat, averaged over a take's
  *measures*, because a per-take mean is where the cancelling happens. It is
  never below `|meanDeviationPct|`, so the gap is the part no direction
  explains.
  `bandFor` / `directionFor` are ports of the pipeline's `classify_band` /
  `_direction` applied to the aggregate — safe only because
  `result_json.tolerance` travels with each take, so **no threshold is invented
  in the app**; that also deleted a third copy of them inlined in `fixtures.ts`.
  `tempoWanders` is two of the server's threshold tests, never a ratio between
  the two figures (`DECISIONS.md`, 2026-09-02), and the spread is tested
  against the **wider** inner threshold because a distance has no side.
  Where a direction would be false the word is **"Uneven"** — the word
  `measureReading.ts` already uses — and the bar fills **both ways**: a centred
  bar under "Your tempo wanders" is the same word-versus-picture contradiction
  one element lower.
  Three things fell out of reading `verdict` as "is anything wrong here":
  `PieceInsightRow` said "On tempo" for the least steady piece in the library,
  `today.ts` skipped that piece for having no direction while sorting it to the
  bottom, and "Recent sessions" ran a *single take* through `formatTendency`,
  whose own comment says one recording cannot see a habit — rendering
  "Today · 96 BPM · You tend to rush".
  **`formatTendency` and `formatTendencyDetail` are module-private to
  `lib/insights/tendency.ts`** and must stay that way. They were exported from
  `lib/tempo.ts` while the headline was a lookup from a verdict, which was
  fine; once it became a rule, the export was a way to get the old answer with
  none of it. Insights was fixed and **Today was not** — for one commit a
  musician read "Your tempo wanders" on one tab and "You tend to rush" on the
  next, about the same thirty days, and it was found by driving the app in a
  browser rather than by any test. Ask through `readTendency`; a third caller
  no longer compiles.

- **Onboarding is one screen, all three answers are required, and the gate
  fails open.** Name, photograph and instrument — the owner's call on
  2026-08-25 (*"dont make name profile and instrument optional"*), reversing
  the skippable version shipped earlier the same day. There is no Skip.
  The rule is enforced **twice on purpose**: `missingFromOnboarding` shuts the
  button, and `PATCH /v1/me` refuses to stamp `onboarded_at` unless the
  **resulting row** carries all three. A requirement only the client checks is
  a convention, and that endpoint is reachable without the screen. The server
  reads the resulting row rather than the body, so an answer already stored
  counts; and a second `{onboarded: true}` on an account already through is a
  no-op 200, never a re-stamp and never a 400.
  The photograph is the expensive one and the cost should stay visible: it is
  the only answer that cannot be given by thinking, so someone signing up away
  from a picture they like is locked out until they find one.
  `users.onboarded_at` records *being asked*. `shouldOnboard` gates only on a
  definite `onboarded === false`: a slow, failed or pre-009 `/v1/me` opens the
  app rather than holding it behind a network request (`DECISIONS.md`,
  2026-08-25). The screen is held in front of the app by `RootNavigator`, not
  pushed as a route, so it needs no `reset` and has no route to be wrong about.
  An account onboarded *before* the fields were required keeps its gaps and is
  never sent back through — `onboarded` is the only thing that decides this,
  never a missing instrument.
  **`users.instrument` is nullable and never defaulted**, the same rule as
  `ScoreJson.clef` and for the same reason — `instrumentInUse()` falls back to
  the device preference, which always has a value, so no screen needs a "no
  instrument" branch.
  Both rules the screen can get wrong live in `lib/onboarding.ts` where they are
  tested, not in the `.tsx`.

### The API serves requests in parallel, and only just started to (2026-08-25)

- **No request handler may be `async def`.** Every one of them was, none
  contained an `await`, and all of them call Supabase through its **synchronous**
  client — so each blocked the event loop and the server served **one request at
  a time**. Measured on the real app with a 1s database call: six concurrent
  requests took 6.02s and `/v1/health` took 5.86s while they ran; as plain `def`
  handlers on the threadpool, 1.01s and 0.002s. That health check is what the app
  blocks *every screen* on while it wakes the host, so this was not one
  endpoint's latency, it was the whole app's. `test_no_blocking_handlers.py`
  asserts it, including for the auth dependencies, which run on every request.
  Writing `async` back is a one-word change a reviewer cannot see, and one person
  clicking around never notices a server with no concurrency.
- **Every blocking call gets a timeout, because a thread is now the thing it
  parks.** Supabase defaults to **120s** (`postgrest_client_timeout`) and PyJWT's
  JWKS fetch to 30s; both are set in `db.py` and `auth.py` now. Starlette's pool
  holds forty threads and is shared with background work, so an untimed call does
  not degrade the API, it removes it.
- **Reading a page dispatches to its own daemon threads, not to
  `BackgroundTasks` and not to a `ThreadPoolExecutor`.** Two reasons for taking
  it off BackgroundTasks and both matter: the Modal spawn is a gRPC round trip
  that has no business in `POST /v1/scores`, and `run_transcription` waits for a
  slot by *blocking a thread* — harmless when that thread came from
  BackgroundTasks alone, an outage now the handlers draw from the same pool.
  **Daemon is the load-bearing word**: `ThreadPoolExecutor` registers an `atexit`
  hook that joins its workers, so a restart during a read blocks for the whole
  read (measured: 8s task, 8s delay to `sys.exit`). A process that goes down
  mid-read leaves the row `reading`, which the sweeper already recovers.
- **On the app side, the wake goes stale.** `warmApi` was resolved once and held
  for the life of the process, so it protected the first screen of a session and
  nothing after it — while the host sleeps every fifteen minutes. Any response
  refreshes `lastContactAt`; a wake older than ten minutes is armed again.
- **`send` already retried, so React Query must not.** Two 45s attempts inside
  `send` plus `retry: 1` outside it was three minutes on a skeleton before an
  error appeared. An `ApiError` is never retried — it was answered.
- **Cancel cancels.** `uploadToSignedUrl` takes an `AbortSignal`; the flag that
  used to "cancel" only made the *result* be ignored while the transfer kept the
  phone's entire uplink, so cancelling a slow upload made the app slower.

### The recording path (2026-09-02) — level is not the signal you think it is

- **The onset detector is amplitude-invariant, and this is measured.**
  `onset_strength` differences a dB-scaled mel spectrogram, so scaling a
  waveform shifts every frame by a constant the differencing removes. All six
  fixtures, requantised to 16 bit at each level, read **identically from 0 dBFS
  to -90 dBFS** — tables in `TUNING_LOG.md`, 2026-09-02, pinned by
  `test_the_detector_hears_the_same_notes_however_quiet_the_take_is`. A quiet
  take is a perfectly good take. **Never warn about one**, and never add a
  loudness floor: any non-zero floor takes a verdict away from a musician who
  could have had one. This is the rare threshold that is not a judgement call.
- **The only take with nothing in it is one whose every sample is zero**, which
  is what a muted input, a revoked permission, or a device recording from an
  unrouted source produces. `lib/audio/level.ts` refuses exactly that, before
  the upload and before it costs one of three free monthly analyses.
  `EmptyRecordingError`'s description claimed to cover a muted input for
  months and did not: the check was `durationOf(chunks) === 0`, and a muted
  microphone delivers samples like any other. Yes, this is a client-side rule
  about audio that the server also holds — `DECISIONS.md`, 2026-09-02, argues
  why it is not the fourth-copy mistake, and the argument is directional: the
  app refuses a strict subset, so it can only ever under-refuse.
- **`no_onsets` has two causes and they are not the same person's problem.**
  `expected.size == 0` is a page with no notes read off it — the app's failure,
  named first when both are true, because no amount of re-recording makes it
  analysable. `onsets.size == 0` is the silent recording. The branch used to
  tell both to *"try re-recording a bit louder"*, which is a server fault
  blamed on the musician **and** advice that measurably cannot work.
  `diagnostics.py` has named both correctly all along; only the sentence a
  musician sees was wrong.
- **Both recorders now have tests, and had none.** 400 lines between a
  musician's playing and the file the whole pipeline reads. They are driven
  against stub graphs the way `click.web.test.ts` drives the metronome —
  `expo-audio` is `vi.mock`ed down to a stream that emits `int16` buffers. A
  rule that only the recorder enforces is a rule nothing checks, which is the
  same doctrine the capture path below is written from.
- **A message nobody has seen is a message nobody has checked.**
  `walk-app.mjs`'s silent-microphone leg uses
  `createMediaStreamDestination()` with nothing connected — a real
  `MediaStream` carrying a real track that produces silence — so it exercises
  the actual worklet in the actual built app. That is the pair to the refused-
  microphone leg beside it, and both exist because the container has no audio
  device and every unstubbed run takes the `NotFoundError` branch.

### The capture path (2026-08-24) — what an audit of it found

Nine defects between the shutter and a saved score, in a path that had **zero
tests**. Read these as rules, not history — each one is a mistake that was
actually made here.

- **A photograph enters a session only through `captureSession.capture()`.**
  `add` and `replace` are not exported, deliberately: a shutter that *can*
  append is one that can append past a pending retake, which is exactly what
  happened. Retake used to `remove` the page and let the shutter append the
  replacement, so retaking page 1 of a four-page scan put the new page 1 at
  position 4 and promoted page 2 — and the upload sends `pages[0]`, so the app
  transcribed a page nobody chose while the re-shot one was never sent.
- **A retake is a pending swap, never a delete followed by a capture.**
  `beginRetake` removes nothing. Closing the viewfinder or a shutter that
  returns no image must leave the scan exactly as it was.
- **`Scanner` takes `{ adding?: boolean }` and the caller says which it is.**
  The viewfinder resets the session on mount because opening it is normally how
  a scan *starts* — but it is not the only way back into one, and pages that
  came through Import have no scanner beneath the review list at all. Do not
  replace this by asking the session whether it has pages: an abandoned scan
  looks exactly like one being added to, and appending a new piece's first page
  to it is the failure the reset exists to prevent.
- **Screen rules live in modules, not components.** There is no React Native
  testing library here (see `DECISIONS.md`, 2026-08-24) — a rule inside a `.tsx`
  is a rule nothing checks, and eight of the nine findings were rules inside
  `.tsx` files. `captureSession`, `lib/scan/drag.ts` and
  `lib/transcriptionProgress.ts` are the pattern. Navigation is the part still
  untested, and that is a known gap rather than a solved problem.
- **A cancelled gesture is not a finished one.** `onPanResponderTerminate` ran
  the release body, so a drag interrupted by a call or by the enclosing
  ScrollView committed a reorder nobody completed — and changed which page was
  transcribed.
- **`ScoreJson.clef` null is captioned "Clef not read".** The stave must place
  noteheads somewhere, so `UNREAD_CLEF_PLACEMENT` is the one named assumption
  and the screen declares it. Never `?? 'treble'` — it captions a guess
  identically to a reading *and* places every note of a bass part a seventh off.
  A clef control on `PieceScoreScreen` sets it; **"Not stated" is a real choice**,
  not a cancel.
- **The upload's extension follows the *type*, never the filename.** They had
  separate fallbacks, so an unrecognised name declared `image/jpeg` and filed
  the object as `page.heif` — which `_extract_ext` refuses, showing the musician
  a server rule string for a page that never left the phone. `MAX_PAGE_BYTES`
  is checked before sending, because `UPLOAD_TIMEOUT_MS` is a *total* timeout.
- **Advice must be followable in this app.** The 413 message named a camera size
  setting the scanner does not have and a file importer that refuses JPEGs. Its
  test asserted that *some* advice was given, which is how it survived. When
  writing an error, name a route that exists.
- **Every object in these buckets has a row somewhere.** A `scores` row because
  it became a piece, an `analyses` row because it became a take, a
  `users.avatar_url` because it became a face, or a `pending_uploads` row
  because it has not become anything yet. An object with no row is a bug rather
  than a Tuesday. This replaced the standing "orphaned uploads" hole, where an
  upload that never became a score row was unreachable forever — backing out of
  the naming screen, a failed save or a retried transcribe each stranded a
  musician's photograph with no request that could remove it, including theirs.
  Two orderings hold it: **claim after the row exists** (clearing first strands
  every save that then fails) and **sweep the object before the row** (a row
  deleted first leaks its object silently, which is the same bug one level
  down). `record` never raises — failing the upload because the bookkeeping
  failed costs the musician their page, which is the thing the bookkeeping
  exists to protect — `keys_for_user` is the one function there that does
  raise, and its docstring says why.
  **Account deletion is the fourth place these keys live, and it read three of
  them.** `DELETE /v1/me` inventoried `users`, `scores` and `analyses`, never
  `pending_uploads` — whose `user_id` migration 014 added *"so that deleting an
  account can take its unclaimed uploads with it"*. That row cascades from
  `auth.users`, so removing the identity removed the only index of the object:
  no row, no owner, no sweeper entry, unreachable by every request including
  the musician's own, produced by the one action they take to make their data
  go away. It is read **last** in `_account_storage` so the fallback for a
  deployment predating the migration can be narrow — any other failure would
  already have aborted on the three queries above, and refusing to delete an
  account over a missing table is worse than the bug being fixed.
  **Migration 014 is applied on `intempo-dev` and nowhere
  else** (2026-09-02, verified against `supabase_migrations`). The paused
  `intempo` project stopped at 012, so if it is ever unpaused as production the
  sweeper finds no `pending_uploads` table there and the hole is still open on
  it. A migration that exists in the repository is not a migration that has
  run: **013, 014 and 015 all sat unapplied for weeks**, and 015 was the reason
  the start-bar picker — merged to `main` — refused every take.

**Four screens a fixtures build can never reach**, because they sit behind
auth or account state rather than behind a route: `AuthScreen` (`signedOut`),
`SetPasswordScreen` (`recovering`), `AccountStartupScreen` (`loading`) and
`OnboardingScreen` (`onboarded === false`). Every sweep in this repository
misses all four. To look at one, flip the single value that gates it in a
**throwaway build** — `useAuthStatus`'s fixture default, `onboarded` on the
fixture musician, or `fixtureMusicianSource.getMusician` made to throw (the
error state) or never settle (the loading state) — and restore it with a
`diff -q` check, the same discipline `.env` gets. Cheapest is **one** build in
which each of those reads a query parameter, so every state comes off a single
bundle instead of one build apiece; all four were walked that way on
2026-09-02.

There is **no `?startup=` parameter in `SignedInApp`**, whatever this file said
before: that screen is gated on `useMe()`'s `isPending` / `isError`, and
nothing in shipping code branches on the URL. The note is corrected rather than
deleted because a documented technique that does not exist costs the next
session the time to discover that, which is what it cost this one.

**The sixth such state is the one every single user meets first: an account
with nothing in it.** Every fixture build has a library, a take and thirty
days of insights, so Today, Library and Insights are only ever seen populated.
Looking at the empty one is five one-line edits to `fixtures.ts` — early
returns at the top of `listPieces` (`[]`), `getCurrentPiece` (`null`),
`getInsights` (`null`), `getLatestTake` (`null`) and `getRecentTakes` (`[]`) —
then `.env` aside, `npm run build:web`, serve, look, `git checkout --` the
file. `tsc` reports unreachable-code errors on that build; they are the patch,
not the app. Doing it on 2026-09-02 found Today telling a new musician
*"Nothing to practice yet"* above a fully built daily warmup it was hiding from
them.

A state with no fixture is a state nobody has looked at, and that has
now cost this project **six** times: a guessed clef captioned as read, an
84×154 box of padding where a cover should be, two post-scan screens never
rendered, onboarding asking a returning musician for a photograph their
account already had, `AccountStartupScreen` holding a centred spinner between
two left-aligned sentences with the one button the screen exists to offer at
the vertical middle of the phone (2026-09-01), and the empty Today above.

**Every brand asset is still the Expo starter's** (measured 2026-09-03, by
looking at them): `icon.png`, `favicon.png`, the three Android layers and
`public/app-icon.png` are a blue chevron on pale blue with the template's
construction guides — dashed sight lines, two circles and a centre crosshair —
on a product whose identity is warm paper and engraved notation. `icon.png` is
1024×1024, RGB, no alpha, so App Store Connect would take it. **A wrong icon is
not a build failure; it is a build that succeeds and is wrong.**
`tools/check-brand-assets.py` lists them by hash and runs in CI. It does not
fail while they are listed — drawing them is the owner's under §2 — but it does
fail if a *new* asset ships as the starter's, or if a listed one is drawn and
its line becomes a false claim. **This blocks the App Store submission**, and
nothing else in the repository said so.

`assets/splash-icon.png` was the same placeholder, referenced nowhere, and is
deleted. There is **no splash configuration**: `expo prebuild` emits the bare
template's `SplashScreen.storyboard`, whose background is
`systemBackgroundColor` — white — so an iOS cold start flashes white before the
app paints `#F7F2E9`. Wiring `expo-splash-screen` with a `backgroundColor` and
no `image` does **not** fix it: measured on 2026-09-03, its plugin only rewrites
the storyboard's background inside `applyImageToSplashScreenXML`, so with no
image it leaves the white background, two constraints pointing at the imageView
it just deleted, and an orphan `SplashScreenLogo` resource. That was tried and
reverted — a launch storyboard that may not compile is worse than a flash.
The splash wants the real mark on it, so it is one job with the icon.

**Honest DoD status:** no batch is tagged `batch-N-done`. Every remaining gate
(live magic-link auth, upload→OCR→save, mic→analysis) is blocked on Supabase
keys and a real device — none of it can be closed in-session, and the screens
are verified *visually*, not end-to-end.
