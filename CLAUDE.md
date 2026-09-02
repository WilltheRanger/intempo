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
  `transcriptionProgress.test.ts` fail otherwise, in both directions.
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
- **Four things flag a measure, and only one of them is arithmetic.** Beat sums
  (`verdict`), broken ties, tuplet ratios that contradict their bracket, and
  note density far above the page's median. The last three all exist because a
  measure can sum to **exactly** the right number of beats and still be wrong —
  a slur written as a tie, a 5:4 bracket approximated as triplets, a tremolo
  read as sixteen sixteenths. Keep them separate from `verdict`; collapsing
  them lets a clean beat sum hide them.
- **The validator has one home and two ports**, and they must agree:
  `ocr/validate.py`, plus `tools/validator-sandbox.template.html` and
  `tools/scan-bench.template.html`. `test_sandbox_parity.py` is the only thing
  holding them together — when you add a check, port it and add a case, or the
  browser tools will quietly call a bad page clean.
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
  exists to protect. **Migration 014 is written and not yet applied**, so on a
  deployment that has not run it the sweeper finds nothing and the hole is
  still open.

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

A state with no fixture is a state nobody has looked at, and that has
now cost this project **five** times: a guessed clef captioned as read, an
84×154 box of padding where a cover should be, two post-scan screens never
rendered, onboarding asking a returning musician for a photograph their
account already had, and — the first time anyone looked at it, 2026-09-01 —
`AccountStartupScreen` holding a centred spinner between two left-aligned
sentences, with the one button the screen exists to offer sitting at the
vertical middle of the phone.

**Honest DoD status:** no batch is tagged `batch-N-done`. Every remaining gate
(live magic-link auth, upload→OCR→save, mic→analysis) is blocked on Supabase
keys and a real device — none of it can be closed in-session, and the screens
are verified *visually*, not end-to-end.
