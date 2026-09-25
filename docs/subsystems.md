# InTempo subsystems — what was learned the hard way

Moved out of `CLAUDE.md` on 2026-09-06, unchanged. It was ~88% of that file and
was being loaded at the start of every session; the binding rules are ~12% and
stay there. See `CLAUDE.md` §5.

**Read the section for the subsystem you are about to touch.** Reading it all is
not the point and never was.

**The longest section here used to describe the legacy `frontend/` tree, and it
is gone with the tree** (2026-09-09). It was kept for a while on the reasoning
that documenting an old codebase costs nothing — and that was wrong in a way
this file is the right place to record. A session read those conventions as
binding for `mobile/`, which is a different application with a different
palette; the section was the mechanism of that mistake, not a defence against
it. `git log -- docs/subsystems.md` has the text if it is ever wanted.

Every entry here exists because something was actually got wrong. They are
written as rules, but they are post-mortems: the reason matters as much as the
instruction, because a rule whose reason has expired is worse than no rule — this
document contains at least two of those, and says so where it knows.

## Contents

- [The `mobile/` tree and transcription](#the-mobile-tree--where-transcription-actually-stands-2026-08-24)
- [Dependency advisories, and the fix that would undo the app](#npm-audit-fix---force-would-take-this-app-back-to-sdk-46-2026-09-09)
- [The API's concurrency](#the-api-serves-requests-in-parallel-and-only-just-started-to-2026-08-25)
- [The recording path](#the-recording-path-2026-09-02--level-is-not-the-signal-you-think-it-is)
- [The capture path](#the-capture-path-2026-08-24--what-an-audit-of-it-found)
- [Signing in, and where the session lives](#signing-in-and-where-the-session-lives-2026-09-17)

---

## The `mobile/` tree — where transcription actually stands (2026-08-24)

The shipping app is `mobile/` (Expo, also built to web for Cloudflare Pages),
and the scan flow there works differently as of 2026-08-24:

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
- **CI builds the iOS bundle, not just the web one** (2026-09-03; **the job
  exists and has not run since 2026-09-09** — every job in `ci.yml` fails two
  to three seconds in with no logs, a blocked run rather than a broken one, and
  only the owner can clear it. `tools/preflight.py --full` builds the bundle in
  the meantime; see `CLAUDE.md` §1). Every other
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
  no Apple account, no EAS credentials here.
  **What still needs a person is `tools/check-store-readiness.py`, not a
  sentence.** This line and `mobile/README.md` both said "three things" and
  named the EAS and Apple ones, omitting the brand assets, the publisher's
  details in `lib/legal.ts` (`entity`, `contact`, `jurisdiction`, all null) and
  a policy at a public URL — which App Store Connect asks for as a URL, not a
  screen. Six, not three. The tool reads `app.json`, `legal.ts` and the
  brand-asset hashes live, so an item stops being listed when it is done and
  nothing here has to be edited; the two that need an account are stated rather
  than measured, and say so. There is deliberately no `development`
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
- **An export nothing references is the client-side twin of that, and there is
  one check for each direction.** `test_client_reachability.py` holds the
  server; `tools/check-dead-exports.py` holds the app, failing on a named export
  that appears **nowhere else in the corpus at all** — not a screen, not a test,
  not a tool. 511 exports at the time of writing — 591 as of 2026-09-09 — zero
  dead, and it runs in CI beside the EDIT_LOG and brand-asset checks, which
  since 2026-09-09 means it runs in `tools/preflight.py` and nowhere else:
  the workflow is blocked, not broken. See `CLAUDE.md` §1. It has **no allowlist**, deliberately: an exclusion list is
  the thing that rots (see `excluded_on_purpose` further down), and the remedy
  for an export nothing uses is to stop exporting it. A name common enough to
  appear in unrelated prose is matched by that prose and passes, so its failures
  are false *negatives* — the direction a check has to fail in if people are
  going to keep running it.
- **Which endpoints have no client is `NOT_WIRED`'s answer, not this file's.**
  Today it holds one: `POST /v1/calibration` (spec §4, infer a target BPM from
  a short clip). `bpm_source` carries `calibration_clip` for it, and
  `submitTake.ts` described that flow *in the present tense* while sending
  `manual` every time. Do not restate the list here — this bullet named
  `POST /v1/analyses/:id/corrections` as unwired for one day after the verdict
  screen started posting to it, contradicting the entry six bullets down that
  says the loop has a client. **A count of unwired endpoints in prose is a
  claim, and it goes stale in a day.**
  What is worth keeping is *why* an empty one matters. The corrections router's
  own docstring calls the loop *"the only route out of the position Batch 3 is
  currently stuck in"* — thresholds still on the spec's starting values because
  tuning needs real ears on real recordings, and an empty table cannot tune
  anything. Verdict corrections are also easy to confuse with the *reading*
  corrections, which are a different table and a different flow:
  `MeasureEditScreen` → `scores.py` → `services/training.py`, consent-gated by
  migration 013, and that is what the Profile toggle and the privacy copy are
  about. Both are called "corrections".
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
- **A quarter of every read was a title nothing reads** (2026-09-24). homr runs
  RapidOCR over the strip above the first staff, on a thread beside its
  transformer, to fill `<work-title>` — which `musicxml.py` never imports.
  RapidOCR's default detector scales an image's *short* side up to 736 px, so a
  ~1920×270 strip was searched at ~5200×736: 4–7 s on four cores, taken from
  the transformer reading the staves. `homr_provider` now builds homr's title
  reader itself, detector limited by its long side (`_TITLE_READER_PARAMS`),
  into the slot homr fills only while empty. A photographed full page went from
  10.1–14.2 s to 7.9–9.7 s and about 30% less CPU, and every `ScoreJson` came out
  byte-identical. homr's code is untouched; skipping the title step outright
  measured 0.1–0.7 s faster still, and would mean running a changed homr —
  the owner's call under the AGPL note above, not one to make in passing.
  **When a read is slow, time the stages before touching one**:
  `tools/reader-speed.py` prints each, cold then warm, and `--as-homr-ships`
  reads the old way so the score digests can be compared. The slow part was
  not the one reading notes. And `transcribe_score` keeps its container 300 s after a read
  (Modal's default is 60), so a retake or the next piece skips the container
  start, 2–4 s of imports and the model loads — Immich's model TTL, for the
  same reason.
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
  *used* to match no `_FAILURE_REASONS` needle and land on *"a flatter,
  better-lit shot of the page usually fixes it"* — a server fault blamed on the
  musician, for the third time. It has a needle now (`"not installed"`), with
  four more beside it for the other ways the server can be at fault, and
  `_why_it_failed` flattens underscores **and hyphens** so `GEMINI_API_KEY`,
  `x-api-key` and "api key" are one fact rather than three. Verified live:
  that string returns *"That is a fault on our side, not with your
  photograph"*. Read this as the reason the needles exist, not as an open bug.
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

- **Onboarding is one question a screen, two answers are required, and the
  gate fails open.** Name and instrument. The photograph was the third from
  2026-08-25 (*"dont make name profile and instrument optional"*) until the
  redesign's step called it optional and the owner confirmed it on 2026-09-23
  (`DECISIONS.md`). The role and "how did you find us" are device preferences
  and required by nothing. There is no Skip on the two that count.
  The rule is enforced **twice on purpose**: `canContinue`
  (`lib/onboardingSteps.ts`) holds Next shut on those two steps, and
  `PATCH /v1/me` refuses to stamp `onboarded_at` unless the **resulting row**
  carries both.
  A requirement only the client checks is a convention, and that endpoint is
  reachable without the screen. The server reads the resulting row rather than
  the body, so an answer already stored counts; and a second
  `{onboarded: true}` on an account already through is a no-op 200, never a
  re-stamp and never a 400.
  The steps are state inside `OnboardingFlow`, not routes: nothing outside the
  flow opens one, and a route is something a deep link can land on half-way.
  "Welcome to InTempo" is shown once from `data/arrival.ts`, set *before* the
  save resolves — the save waits for `/v1/me` to refetch, by which time the
  gate has fallen, so setting it afterwards would let the tabs render first.
  `users.onboarded_at` records *being asked*. `shouldOnboard` gates only on a
  definite `onboarded === false`: a slow, failed or pre-009 `/v1/me` opens the
  app rather than holding it behind a network request (`DECISIONS.md`,
  2026-08-25). The screen is held in front of the app by `RootNavigator`, not
  pushed as a route, so it needs no `reset` and has no route to be wrong about.
  An account onboarded *before* the fields were required keeps its gaps and is
  never sent back through — `onboarded` is the only thing that decides this,
  never a missing instrument.
  **`users.instrument` is nullable and never defaulted**, the same rule as
  `ScoreJson.clef`. This used to add "— `instrumentInUse()` falls back to the
  device preference, so no screen needs a 'no instrument' branch", and that
  function was **called by nothing** (measured 2026-09-03: the only dead export
  of 499 in `mobile/src`). It is **deleted** now, because
  `adoptAccountInstrument` below is the reconciler that actually runs and the
  two stated opposite rules — `instrumentInUse` said the account always wins,
  the shipped one says the account seeds a device that has never stored an
  instrument and never overrides one. A dead function stating the losing rule is
  a trap: wiring it up reverts a musician's own choice from a value the server
  was never told. `tools/check-dead-exports.py` is the standing check that found
  it and now keeps the tree at zero. No screen needs the branch because no screen
  reads
  the account's instrument at all; everything that acts on one — the warmup,
  `submitTake`, the Profile control — reads `preferences`, the device cache.
  The reconciler was written, documented and never wired up, so **the sentence
  named a mechanism that is not running.** What the two stores actually do:

  | | writes account | writes device |
  |---|---|---|
  | `OnboardingScreen` → `useUpdateProfile` | yes | yes (mirrored on success) |
  | Profile's instrument control | **no** | yes |
  | a fresh install | — | defaults to `violin` |

  **The seeding half is fixed** (2026-09-03).
  `preferences.adoptAccountInstrument` fills the cache from the account **only
  on a device that has never stored one**, which is what makes it safe: a
  device with an instrument has one because somebody chose it *there*, and
  since Profile does not write back to the account, adopting on every load
  would revert that choice from a value the server was never told. An empty
  cache cannot conflict with anything. `RootNavigator`'s `SignedInApp` calls it
  where the account arrives — above the early returns, because a hook below one
  is React error #310, which `EDIT_LOG` records this project shipping once.
  `DEFAULTS.instrument` is `violin`, so "stored violin" and "nobody said" are
  indistinguishable from `current` alone; `instrumentIsStored` is the flag that
  tells them apart, and it is cleared on the fresh-install early return rather
  than relying on its initialiser.

  **The other half is not fixed and is a product decision**: Profile's control
  still writes only the device, so the account keeps the onboarding answer for
  ever. Making it write the account means choosing what happens offline —
  follow `changeTrainingConsent` and the control stops working without a
  network (and in fixtures builds); write locally *and* fire the update and the
  two can diverge silently. Not a quiet refactor; ask first.
  Both rules the screen can get wrong live in `lib/onboarding.ts` where they are
  tested, not in the `.tsx`.

## `npm audit fix --force` would take this app back to SDK 46 (2026-09-09)

`npm audit --omit=dev` reports **24 advisories, 7 of them high**, and closes
with the advice to run `npm audit fix --force`.

**Do not.** The only fix npm can find resolves `expo` to **46.0.21** — from
`~57.0.13`, eleven major versions back — because its resolver satisfies "no
known advisory" by walking backwards to a release from before the vulnerable
transitive dependency existed. It does not present that as a downgrade. It
presents it as vulnerabilities fixed.

**What the advisories actually are.** Every high-severity one is build tooling:

| Package | Reached through | Runs |
|---|---|---|
| `metro`, `metro-config`, `metro-transform-worker`, `@expo/metro` | the bundler | build time |
| `js-yaml`, `image-size` | Expo's config and asset pipeline | build time |
| `@xmldom/xmldom` | `@expo/prebuild-config`, which rewrites native manifests | build time |

None of it is in the bundle a browser downloads or the binary a phone runs.
That is a real distinction, not a dismissal — a hostile `.icns` or XML in a
build input could hang or exploit the machine doing the build — but it is a
different and smaller risk than "the app is vulnerable", and the number on its
own says the wrong one.

`tools/check-dependencies.py` is the reading of this: it fails on `critical`,
reports the rest with the packages named, and prints the warning above every
time so the advice is next to the number.

**The Python side is not checked by anything.** `uv` has no audit command and
nothing else covers `backend/`. Named here rather than left to be found.

## The API serves requests in parallel, and only just started to (2026-08-25)

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
  **This sentence was true and held by nothing** until 2026-09-03: the three
  constants had one definition and one use each, and no test. Dropping
  `_options()` from a factory — or adding a fourth factory without it — restored
  the 120s default and passed the whole suite.
  `test_blocking_timeouts.py` checks it by **calling** the factories with
  `create_client` and `PyJWKClient` monkeypatched, so the assertion lands on the
  options object that reaches the library rather than on a line of source, and it
  **enumerates** the `get_*_client` factories out of the module — the mutation
  worth guarding is the factory added next month by someone who has never read
  this file.
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
  **A write is never repeated at all**, and that is the more expensive half: a
  POST that timed out may have been received and run with only its answer lost,
  so asking again submits a second take or creates a second piece the musician
  never made. React Query's default is one retry for mutations too.
  Both policies lived as a `const` in `App.tsx` with nothing holding them until
  2026-09-03; they are `data/queryClient.ts` now, because a rule inside a
  `.tsx` is a rule nothing checks — the same doctrine the capture path is
  written from. Neither is reachable by a walk or a screenshot: a duplicate take
  needs a timed-out POST the server actually ran, which nothing here can stage.
  The query side is driven through `fetchQuery` and counted; the mutation side is
  asserted as configuration, because there is no React testing library here and
  `false` has nothing between it and the library.
- **Cancel cancels.** `uploadToSignedUrl` takes an `AbortSignal`; the flag that
  used to "cancel" only made the *result* be ignored while the transfer kept the
  phone's entire uplink, so cancelling a slow upload made the app slower.
- **An analysis in this process takes the process with it, and the first one
  in a new process was two minutes of compiling** (2026-09-23). librosa's
  numba code compiled on the first take after every deploy or wake, because
  the cache numba wrote belonged to the container. While it ran, the app's
  status polls, normally about 4 s apart, showed gaps of 25–27 s, most likely
  from the same starved CPU. The images now compile it at build time
  (`workers/warmup.py`,
  `DECISIONS.md` 2026-09-23). Two things are easy to undo without noticing,
  and both leave every verdict correct and slow. The first is
  `NUMBA_CPU_NAME=generic`: without it the cache is keyed on the builder's CPU
  and misses on every server. The second is a new librosa code path the
  warm-up does not walk. `test_warmup.py` catches both, and it is slow on
  purpose.

## The recording path (2026-09-02) — level is not the signal you think it is

- **A synthetic instrument can give you the exact opposite answer, confidently
  (2026-09-14).** Chasing "the detector over-fires on bowed attacks", a bowed
  note was modelled as a squared ramp on a pure sine. Against it, raising
  `[onset] delta` from 0.07 to 0.12 was a clear win: struck takes untouched, a
  120 ms attack going 0.000 → 0.789, the dynamics sweep survived, the six
  corpus clips byte-identical.

  The repository already had `audio_helpers.synth_bowed_note` — a Helmholtz
  sawtooth under a raised-cosine rise, in a room with a mode and a mic floor,
  written for exactly this. Against *that*, the same change reads 0.984 → 0.393
  on a bowed violin and loses 15 notes of 95. A pure sine has one partial and
  almost no flux at onset; a bowed string has a harmonic series and plenty. The
  threshold was reverted before it left the working tree.

  Two things to carry: **look for the model before building one** — the same
  lesson as the Postgres and the Supabase MCP in `CLAUDE.md` §1 — and treat a
  corpus of click tracks as unable to veto a detection change rather than as
  agreement. `delta` does not reach a click track at all, so six green clips
  meant nothing.

- **"Over-detection" was the wrong name for it (2026-09-14).** On a 95-note
  page at a 120 ms bass rise no note fires twice: the closest two detections
  sit 279 ms apart against a closest written gap of 375 ms, because
  `pre_max`/`post_max` are derived per take from that gap and already exclude a
  re-trigger. What actually happens is that **every onset lands late by an
  amount that moves** — +61 ms after a long note, +123 ms inside a run of
  eighths. A constant lag is free, since `_residuals` fits offset and rate
  before quality is measured; only the variation survives, and it is what costs
  the take. `test_bowed_attacks.py` pins it.


- **A take is compared against the whole page, and for a long time that meant a
  practice take could not pass (2026-09-14).** The first eight analyses this app
  ever ran were all refused with "check you're on the right piece", all at
  `quality` exactly `0.000`. None of them was on the wrong piece.

  `quality` is `timing_quality * coverage`, and `coverage` divided by every
  required note on the page. So `coverage <= n_detected / n_expected` is a
  **ceiling that applies before a single note is compared**. Those takes ran 2 to
  56 seconds against parts spanning 74 to 82, and five of the eight had a ceiling
  under `broken_quality` (0.4) — 0.081, 0.149, 0.307, 0.387, 0.387. However well
  they were played, they could not have passed.

  Compounding it, `librosa.sequence.dtw` was called with `subseq` at its default
  `False`, which anchors the warping path corner to corner: the first detection
  onto the first written note, the last onto the *last*. A fragment was
  therefore stretched across the whole page and every residual was enormous.

  Both are repaired in `align_dtw` — see `DECISIONS.md`, 2026-09-14. Two things
  learned that outlive the fix:

  - **A ceiling is not a threshold, and the difference is invisible in the
    reading.** Every one of those rows said `quality 0.000`, which looks like a
    tuning problem and is not one. `TUNING_LOG.md` had already recorded the same
    shape for `04_slurred` in 2026-08-27 and called it "a design question rather
    than a threshold" — and the note sat there while eight takes failed of it.
    When a metric is a product of factors, log the factors: `AlignmentResult`
    now carries `timing_quality` and `coverage` separately, and `analyze()`
    logs both on refusal, because the product alone cannot say which half said
    no.
  - **Span, not count, is what tells a fragment from a performance.** The first
    attempt at the fix triggered on `detected.size < expected.size`, which is
    also true of a page with printed ornaments played straight — eight
    detections against ten written onsets, and a complete performance. Missing
    attacks do not move the first and last onset; recording part of a page does.

- **Nothing in this repository has ever run the pipeline against a real
  instrument (2026-09-14).** `fixtures/audio/README.md` opens by saying the six
  corpus clips were never recorded, and `make_synthetic.py` stands in for them
  while its own header says a synthesised click "cannot tell you whether a
  threshold is right". Every threshold in `config.toml` was therefore set against
  click tracks, and the failure above lived in the gap for as long as it existed.

  Capturing one after the fact is harder than it sounds: `keep_playback_copy`
  re-encodes a take to Opus once the analysis succeeds, and the WAV is deleted
  an hour later by `sweep_judged_originals` (at once, before 2026-09-24), so the
  real takes survive only as lossy copies. If you want a real-audio fixture,
  take the WAV within that hour or arrange to keep it *before* the take is
  recorded. What each take's analysis saw — every attack, the reading chosen,
  the alignment's halves, the pitch evidence and the refusal rule — is kept on
  the row as `analyses.diagnostics` since 027, so a refused take can be
  diagnosed without its audio.


- **The page's audio session category decides whether the microphone works at
  all, and it is set at boot far away from the recorder (2026-09-12).** This
  cost five wrong fixes over one day, so it is written out in full.
  **Confirmed on the owner's iPhone on 2026-09-13**: with the change below a
  take records; it was the sixth diagnosis and the first correct one.

  `App.tsx` calls `prepareForPlayback()` on mount, which sets
  `navigator.audioSession.type = 'playback'` so the app is audible on a phone
  whose ring switch is off. WebKit honours that literally. In
  `MediaDevices::getUserMedia`:

  ```cpp
  auto categoryOverride = AudioSession::singleton().categoryOverride();
  if (categoryOverride != AudioSessionCategory::None
      && categoryOverride != AudioSessionCategory::PlayAndRecord)
      promise.reject(Exception { ExceptionCode::InvalidStateError,
          "AudioSession category is not compatible with audio capture."_s });
  ```

  Every audio capture on the page is refused, **before a constraint is read and
  before a device is chosen**, for the life of the document. The remedy is one
  line: declare `play-and-record` before capture and hand `playback` back after
  the take — `lib/audio/session.web.ts`.

- **Why it took five attempts, which is the part worth keeping.** The failure
  surfaces as `InvalidStateError` on `getUserMedia`, and that name has an
  obvious reading — "the document is not fully active" — which is the *other*
  branch of the same WebKit function. Every fix was built on the obvious
  reading plus whatever was nearest in our own code: a reload button, then the
  order of the `AudioContext` against the microphone, then a second context,
  then suspending the shared one, then the audio constraints. Each was
  plausible, each shipped with tests, and **none of them could have worked**,
  because the guard reads a process-level category that no `AudioContext`
  operation writes and no constraint influences.

  Three rules come out of it:

  1. **When an error name has an obvious cause, find the code that raises it
     before fixing the obvious cause.** WebKit is open source; the guard above
     took one fetch. Four fixes were reasoned from the name alone.
  2. **`microphoneFailure` threw away `error.message`, and the message was the
     answer.** WebKit had been saying *"AudioSession category is not compatible
     with audio capture."* since the first report. Keep the browser's own words
     — the same lesson `score/listenFailure.ts` records, learned again and more
     expensively. **Fixed 2026-09-13**: `lib/causeOf.ts` is
     shared by both paths now, and every branch of `microphoneFailure` carries
     the cause — including the *recognised* ones, which is where it matters
     most, because a matched row reads as a diagnosis.

  4. **Nothing said which build was running, and that cost a further day.**
     The fix shipped, the phone still failed, and "stale cache", "home-screen
     app resumed rather than relaunched" and "tested before the deploy landed"
     are three different answers that look identical from a screenshot. The
     owner had also been comparing a branch preview against production without
     either side realising they were different origins carrying different code.
     `lib/platform/buildMarker.ts` now prints eight characters of the bundle
     hash, the host, and whether this is the installed app — **beside a failure
     only**, never as furniture.
  3. **A comment that states a platform assumption is load-bearing.**
     `session.web.ts` said *"this app records through a separate path with its
     own session"* — true on native, false on web, and the entire bug. The
     tests agreed with it, so nothing contradicted it.

- **The one thing Chromium can never tell you about this app.**
  `navigator.audioSession` does not exist there, so `prepareForPlayback` returns
  early and the category is never set: the walk, the accessibility sweeps and
  `device-check.mjs` all pass on a build that cannot record on any iPhone.
  **That WebKit is not here, and this line said it was (corrected
  2026-09-16).** `/opt/pw-browsers` holds Chromium, a headless shell and
  ffmpeg; `webkit.launch()` fails on a missing `webkit-2359/pw_run.sh`, and
  the environment ships `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. A documented
  tool that is not installed is worse than none — it reads as a check somebody
  could have run.

  What is left is a source check, which is this project's usual answer for a
  thing no browser here can see. **`session.capture.test.ts` holds the
  invariant that actually protects the microphone**: every path that opens a
  capture declares `play-and-record` immediately before it. That is what makes
  playback harmless — the metronome, the score player and the held-take
  control on the record screen all leave `playback` behind, and the next take
  replaces it — and it is the rule that breaks the day somebody adds a second
  `getUserMedia` for a tuner or a level meter.

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

- **Noise, clipping and reverb do not break onset detection. Dynamics under
  reverb do (2026-09-19).** Every synthetic fixture here is a clean close-mic
  recording, so "does this survive a worse recording" had never been asked.
  `audio_helpers` now models the three axes a phone recording actually moves
  along — `add_noise_at_snr`, `add_room_reverb`, `apply_clipping` — and
  `test_degraded_audio.py` sweeps them.

  The headline is a **negative result** and it is worth as much as a fix. At
  **0 dB SNR**, under hard clipping, and in a **2-second room**, all 24 notes
  are still found with 6–8 ms of jitter. Lowering `delta` or adding a denoiser
  would be tuning something that is not broken — the 2026-09-14 mistake again.

  What moves is the **systematic lag**: 42 ms clean, 65 ms degraded. That is
  free, because `_residuals` fits offset and rate per take before quality is
  measured. Jitter is what is left and it barely moves.

  **The first version of the sweep said the exact opposite**, and the
  correction is the transferable part. Matching detections to truth within
  50 ms, recall fell to 0.00 at 0 dB SNR while `n_detected` stayed at 24 — the
  detector was finding every note and the window was measuring the lag rather
  than the detection. **A match tolerance narrower than a known systematic
  offset measures the offset.** It was nearly reported as "the pipeline
  collapses under noise", which is false.

  What does break it is **dynamic range against a reverberant room**, which no
  clean fixture can contain:

      20 dB range, dry          24/24 found
      20 dB range, RT60 0.9s    16/24
      30 dB range, dry          24/24
      30 dB range, RT60 0.9s    12/24

  The tail of a loud note raises the floor under the attack of the quiet one
  after it, and the onset envelope is normalised against the take's **global**
  maximum, so the quiet attack never clears `delta`. **Precision stays 1.00** —
  nothing spurious, nothing mistimed, the quiet notes are simply gone. That is
  the worst shape this failure could take, because `coverage` falls and
  `quality` is `timing_quality * coverage`: a musician who played musically in
  a live room is told the take could not be read, or is shown a verdict
  computed from half their notes with nothing saying so.

  The fix is not a lower `delta`, which raises the floor everywhere and costs
  precision on every clean take. It is a **local** threshold — each attack
  judged against its own neighbourhood rather than against the loudest moment
  of the take. Not yet made; the ceilings in `test_degraded_audio.py` are
  asserted with `<=` so that fixing it fails the test and forces them to be
  raised deliberately.

- **A more sensitive detector could not be made to work; a second pass could
  (2026-09-19).** The fix for the defect above was attempted twice.

  **Attempt one, reverted:** replace the absolute `delta` on a globally
  normalised envelope with a local one. The diagnosis was right — a quiet
  note's peak collapses 0.22 → 0.030 under reverb while `delta` stays 0.07, so
  it is rejected by about the width of `delta`. It fixed the target case and
  **passed all six corpus clips at every setting tried**, which is exactly why
  it was nearly shipped. Against the full audio suite it failed at every
  window (13–14 failures against a baseline of 0), and the casualty was every
  assertion in `test_varied_rhythm.py`: **a local baseline computed as a mean
  is raised by dense passages and lowered by sparse ones**, so on mixed note
  values the threshold moves with the rhythm it is supposed to be a reference
  for. Structural, not a tuning miss.

  **Attempt two, shipped:** `services/onset_recovery.py`, a pass that runs
  after alignment and looks only where the score writes a note and the
  alignment found none. A take that missed nothing is byte-identical by
  construction, so the corpus needed no re-tuning and nothing that reads
  correctly today can move. 92 BPM at 20 dB of range in a 0.9 s room goes from
  `alignment_failed` (quality 0.248) to `ok` (0.603).

  Three things cost time and are worth carrying:

  - **A sweep against a subset of the suite is fiction.** Attempt one's window
    was swept against four hand-picked cases, where 0.50 appeared to fix the
    bowed re-trigger, the noise case and the dynamics win at once. Against the
    full suite that value is 13 failures.
  - **Placement beat parameters.** The recovery pass was first written *below*
    the `is_alignment_broken` early return, where it can never run on the
    takes it exists for — they are refused on coverage and return before
    reaching it.
  - **The guard that makes a low threshold safe is the window, not the
    floor.** `floor_ratio` was first set to 0.08, which looked conservative
    and excluded the entire population being recovered: those peaks are at
    0.030. It is 0.015 now, and what keeps that safe is that it is only ever
    applied within a quarter of the closest written gap of a time the page and
    the take's own fitted pace agree on.

- **That second pass searched the wrong clock, and every fixture hid it
  (2026-09-22).** It predicted a missed note on the *take's* clock — seconds
  since the first note — and searched the envelope on the *recording's*. The
  only take that exercised it started its first note at 0.0 s, where the two
  agree. On any take with a lead-in, which is every real one, it searched that
  many seconds early and handed back whatever peak it found there as the
  missed note: 0.2–0.4 s from any note on the page, read as though real. Fixed
  and pinned by a test that hides one clear note from the first pass.

  **Fixing it surfaced the guard it had never needed.** Searching the right
  place, it "recovered" a genuinely dropped note from the log-flux wiggle of
  room tone — and that wiggle was *more* prominent than some real quiet notes
  under reverb (1.6× its neighbourhood against 1.2–1.5×), so no prominence
  threshold separates them. Level does: room tone sits at the take's noise
  floor, a note lost in a live room is still 30+ dB above it.
  `[onset.recovery] min_level_db`. **When a pass has only ever run on
  fixtures that start at zero, ask whether it has ever run at all.**

- **A log-spectral detector cannot be filtered (2026-09-22).** The flux
  differences *log* mel spectra, so any fixed filter on the waveform is a
  constant per band that the difference removes: the bass's 80 Hz high-pass
  and the pre-emphasis both measure at envelope correlation 0.998–0.9999, and
  `highpass_hz` changes no onset. Moving the cutoff into the detector's own
  bands was built and measured no better — leakage sixty decibels down makes
  the same log-flux as the note. And the room boom it was meant to stop is not
  detected with no filter at all, because it moves two or three of 128 bands.
  `config.toml` says so beside the knob; `test_onset_placement.py` holds it.

- **The 23 ms frame grid was hiding a matcher bug (2026-09-22).** Placing onsets
  on a 2.9 ms grid (`audio.refine_onset_times`) made seven notes of a varied page
  mis-pair after a bar held exactly one beat long — the take then sits exactly
  two eighths behind, a two-note slide through a bar of equal eighths is
  perfect by position, and a sideways DTW step cost nothing extra. The coarse
  grid's jitter had been breaking that tie the right way by luck.
  `STEP_PENALTY_CAPS` prices a sideways step; swept flat from 2 to 6. **When
  more precise input makes a result worse, the precision found a bug.**

- **A page is not always played as printed (2026-09-22).** Slurred notes the
  detector hears, a printed repeat not taken, stopping and going back two bars
  — each was refused as a wrong piece on a take with every note on time.
  `analysis.Reading` builds each as a timeline and keeps the page as written
  unless another fits by `MIN_READING_GAIN`; restarts are only looked for on a
  take under `warn_quality`, so nothing that reads today can move. A stop that
  simply carried on is *scored* but never *chosen*: it looks exactly like bars
  of rest the transcription missed, and those must still be refused. The slur reading needed three matcher changes before a
  *mixture* of heard and unheard slurred notes read cleanly — measuring an
  interval back across unheard optional notes, capping what crossing one
  costs the path, and trying the set tempo when the gaps cannot give a pace.
  The pure cases passed long before the mixed one did, and the mixed one is
  the real one.

- **The pipeline already knew three things about every take and said none of
  them (2026-09-19).** `_residuals` fits `rate, offset = np.polyfit(...)` on
  every analysis and returns only the residuals. `services/insights.py` now
  reports what that slope means, and two more that fall out beside it.

  `target_bpm / slope` recovers the tempo actually played, and it is **exact**
  rather than an estimate — measured against takes synthesised at five known
  tempi: 75.0, 66.7, 60.0, 54.5, 48.0 against a target of 60. The matcher's
  own rescaling does not destroy it, which had to be checked before trusting
  it.

  What the numbers separate, which the verdict cannot:

      take                    verdict              played  drift  steady
      exactly as written      Steady tempo           60.0    0.0     0.6
      25% fast, evenly        You rushed             75.0    0.2     0.7
      accelerando             You rushed             64.3   12.5    26.4
      even average, ±60 ms    Steady tempo — held    60.0   -0.0     6.0

  The last row is the one worth looking at: **the app tells a musician
  swinging ±60 ms that they held a steady tempo.** The average is zero, which
  is all the verdict reads.

  **`steadiness` has to be detrended and the first version was not.** Playing
  evenly at a different tempo makes the delta grow note after note, so a raw
  spread is dominated by that slope — an even take at 75 scored **138.5**
  against **6.0** for one with genuine swings, i.e. the figure ranked the most
  controlled performance in the set as the least steady, and merely restated
  `tempo_difference_bpm` in another unit. Removing the line leaves departure
  from the musician's *own* pace, whatever pace they chose. Found by measuring
  end to end, not by reading the code.

  **Grouping by written note value is the one a metronome cannot give.**
  `ExpectedNote` now carries `beats` — `_beats` already computed it while
  building the timeline, so it costs nothing and cannot drift from the onsets
  it produced. On a page of halves, quarters, eighths and sixteenths with only
  the sixteenths pulled early:

      half notes       n=8    mean  -0.1%
      quarter notes    n=32   mean  +0.9%
      eighth notes     n=36   mean  -0.3%
      sixteenth notes  n=15   mean -11.9%   <- named as the standout

  The verdict for that same take reads *"You rushed in measure 9 by an average
  of 7 BPM"*. One names a bar; the other names the habit, and only one of them
  tells a musician what to practise.

  `standout_note_value` compares each value against the average of **the
  others**, not against zero and not against an average it supplies itself.
  Against zero, a take that rushed throughout would name one value and imply
  the rest were fine — the verdict's finding repeated under a new heading.
  Including the candidate in its own baseline would stop the *commonest* note
  value from ever standing out, which is backwards: it is the one a musician
  most needs told about.

- **A screen that is right every time is a screen nobody reads (2026-09-19).**
  `PracticeSetup` was shown once to every device, whatever its checks came back
  with. On a take with nothing wrong that is two rows of ✓ and a paragraph
  standing between a musician holding an instrument and the record button — and
  both of its items are already on the screen behind it, since the entry bar
  and the metronome each have a row there. It now opens only when a check is
  `warn`, through `hasWarning`, and is reachable any time from "Before you
  record".

  Two things to carry. **`hasWarning` already existed and nothing called it**:
  written with the checks, referenced only by its own test, which is the shape
  `check-dead-exports.py` exists to catch and the one case it cannot see,
  because a test counts as a reference. Look for the predicate before writing a
  second one beside it. And **the gate is wiring, so the tools have to hold
  both halves**: `walk-app.mjs` asserting only that the screen stays out of the
  way would pass just as well against a screen deleted outright, so it seeds
  `metronomeMode: 'audio_with_headphones'` into a fresh profile and requires
  the checks to appear. `audit-a11y.mjs` audits the same pair.

  **Gating it also gave it somewhere to put things.** The record screen carried
  "Double-bass detection is on. Keep the microphone uncovered and give bowed
  attacks a clear start." in the middle of its controls, for every double-bass
  take of every piece. That is real information — `test_bowed_attacks.py` is
  the measurement behind it — and it was in the wrong place, because an area of
  a screen that says the same thing every time teaches a musician to skip it.
  It is a `bowedAttack` check now: `ok`-toned, so it never stops anyone, and
  read when the checks are opened.

- **A two-state toggle over a four-state enum hid three of them (2026-09-19).**
  The record screen's metronome control switched between `off` and whichever
  mode was last on, so a musician who had never chosen one could reach exactly
  one of the four from the screen they were recording on; the other three lived
  in Profile, two navigations away, with an instrument up. It is a picker now,
  from `lib/record/metronomeChoice.ts` — a `Record<MetronomeMode, …>` rather
  than an array, so a fifth mode stops compiling until it is described.

  Profile's `METRONOME_OPTIONS` was a *second* hand-written enumeration of the
  same enum and now derives from that list. Drift between the two would not
  have looked like a bug: the segmented control would simply have been missing
  an option, on the screen a musician was sent to in order to find it.

- **`initialPosition` on a sheet is a claim about a transform, not a state
  (2026-09-19).** `DragSheet` starts the record screen's controls lowered so
  the music is the first thing on screen. Constructing the state as `lowered`
  reported it lowered to the state, the ref and the screen reader while the
  sheet sat visibly over the thing it was revealing — the animated offset
  starts at 0 and only ever moves through `settle`. Travel is
  `travelFor(height, peek)` and `height` is 0 until layout, so the offset can
  only be set from a measurement, in an effect guarded to fire exactly once:
  without that guard any later re-layout — a message appearing inside the
  sheet, the keyboard, a rotation — snaps a sheet the musician had raised back
  down under their hand.

- **Glass cannot be the thing that makes text legible, and engraving is where
  that shows (2026-09-19).** Reported from an iPhone: raised over a page of
  music, the record sheet's controls sat on staves — clefs, noteheads and staff
  lines read straight through `00:00` and the record button, perfectly sharp.

  Two layers were supposed to prevent that and neither could finish the job.
  The blur is `backdrop-filter` on the web and several browsers decline it
  outright; on that phone it did not run at all, so the surface fell back to
  its tint alone. And `glassTint` is 0.80, which leaves 20% of the highest-
  contrast thing this app draws — still a legible grid.

  **So the ground changes and the material does not.** `colors.contentWash` is
  `surface` at 0.94, drawn inside the sheet under the glass. Three things make
  it the right shape:

  - **It is not `scrim`.** A scrim *darkens*, to say the thing behind is
    inactive, and darkening leaves contrast where it found it — black
    noteheads on ivory stay black noteheads. This fades them toward the paper
    they are printed on, which is the only operation that takes detail out.
  - **Inside the sheet, not across the screen.** The first attempt was a
    full-screen wash interpolated from the sheet's offset. It worked, and it
    also fogged the header: the piece title and the music still on show read as
    disabled. What a musician can see past the sheet has to stay sharp — that
    is the reason this sheet drags instead of being a separate screen.
  - **Sharing the sheet's transform**, so it needs no opacity of its own and is
    exactly registered with the glass at every point of a drag. The version
    with its own interpolation also needed a dismiss target, and
    `pointerEvents="none"` leaves an element in the accessibility tree — so it
    put a button a screen reader could find on top of a sheet that was already
    down. Playwright found it by tripping over it.

- **On iOS, `AudioContext.resume()` resolves nothing and the state is the only
  answer (2026-09-20).** Takes failed on a real iPhone with "Audio did not
  start. Return to this screen and try Record again." while the microphone was
  open and the context was running. `startRecording` raced the resume promise
  against a five second deadline; on WebKit that promise frequently **never
  settles** on a context that reaches `running` anyway, so the deadline always
  won. Reproduced against the old code with a context that behaves that way: it
  threw, and `context.state` was `'running'` at the moment it threw.

  **The obvious fix is not available to a take.** `context.web.ts` says
  playback resumes "inside the gesture", and a take cannot: `releaseAudioSession()`
  suspends the shared context *on purpose* before asking for the microphone,
  because WebKit will not reassign the audio session away from a running one
  and capture fails with `InvalidStateError` otherwise. The suspend is
  load-bearing and it spends the gesture, so the resume is unavoidably outside
  one. `lib/audio/running.ts` polls `state` instead, re-asking on each look
  because an interrupted context can refuse the first request and accept a
  later one.

  Two things to carry. **The promise is a hint and the state is the fact** —
  anywhere this app waits on Web Audio. And **no gate here can catch it**: every
  check in this repository is headless Chromium, where `resume()` settles
  promptly and `navigator.audioSession` does not exist at all. That is the same
  blind spot that cost six attempts on the capture-category bug, and it is the
  second time it has been paid for.

- **A stalled fetch does not reject, so a spinner with no deadline has no end
  (2026-09-20).** `beginSampledPlayback` set `onLoading(true)` and awaited a
  download and a render with nothing bounding either, so Listen could spin
  indefinitely — while `listenFailure` already held exactly the right sentence
  for it, "Couldn't load the instrument sound. Check your connection and tap
  Listen to retry.", with no way of being reached. Both stages are bounded now.
  The deadlines are generous on purpose: the failure being removed is an
  *infinite* wait, not a long one, and refusing a musician on poor cellular who
  would have had sound at twenty seconds is worse than making them wait.

- **A centred container silently breaks `space-between` (2026-09-19).** The
  record sheet's settings block had `alignItems: 'center'`, which shrink-wraps
  every child to its own content — so the metronome row, laid out
  `space-between`, had no space to be between and shipped as `MetronomeOff`.
  Nothing catches this: it is not a contrast failure, not a missing name, not
  an overflow. Rows that put a value against the right margin need a stretched
  parent, and the parent is where to look when two halves of a row collide.

- **A sheet that lowers itself makes the web build's page scroll, and nothing
  here could see it (2026-09-20).** `DragSheet` lowers by `translateY`, and in
  CSS a translated absolutely-positioned element still counts toward the
  document's scrollable overflow — so the record screen shipped with
  `document.scrollHeight` at **1219 against an innerHeight of 844**, exactly
  the sheet's 375 points of travel. On a phone that is blank ground under the
  panel, a panel that slides up under the finger, and a drag on the grab handle
  that scrolls the page instead of moving the sheet. All three were reported as
  one complaint.

  React Native clips this on device, so it exists only in the build the app is
  actually looked at in — and every check in this repository drives that build
  and still missed it, because none of them reads `scrollHeight`. The fix is
  `overflow: 'hidden'` on the screen's own root, which is a one-line style and
  was not obvious from any symptom.

  **The walk had been passing *because* of it.** `walk-app.mjs` reached the
  tempo stepper through Playwright's "scroll into view", on a page scroll no
  musician could have used; clipping the stage took that accident away and the
  step started timing out on a control sitting under the take bar. A green
  check that depends on a bug is worse than a red one. It raises the sheet
  explicitly now.

- **Content that must not move belongs outside a sheet that moves
  (2026-09-20).** The record button lived at the top of the drag sheet, kept on
  screen by `peek` — a constant declaring how tall four pieces of conditional
  content would come out. It said 232 and the content measured **256**, so the
  button's own label was clipped by the bottom edge of every phone, on a screen
  with nothing wrong with it. Raising the sheet then put the one control a
  musician reaches for without looking in the middle of the display rather than
  under the thumb.

  It is a bar of its own now, anchored to the bottom edge, outside the sheet;
  the sheet is inset above it and reports nothing about it. `peek` defaults to
  `HANDLE_HEIGHT`, derived from the two tokens the handle's own style is built
  from, because two numbers that have to agree in two files are a number that
  will stop agreeing — the caller that passed this one counted the handle's
  padding twice.

  The failure messages moved into that bar with the button. The sheet used to
  carry a `raiseSignal` that hauled itself up over the music whenever a message
  the musician had to read appeared inside it; a rescue like that only exists
  because something that always has to be seen was put somewhere that can be
  hidden. Both are gone.

### A take nobody played (2026-09-23)

- **The detector cannot tell an instrument from a click, a syllable or a
  knock**, by design — it is amplitude-invariant so a far microphone works. So
  whether a take was *played* is asked separately, of its pitch:
  `pitch_evidence.py`, decided in `analysis.nothing_played`, status
  `not_played`. TUNING_LOG.md 2026-09-23 has every number.
- **Never let the page's pitch share decide alone.** A transcription wrong on
  every note (a misread clef) makes a real take hold none of its written
  pitches. Every "not played" rule requires that share to be no better than
  chance *and* something else — no pitch held, one pitch every time on a page
  with several, or neither an instrument's steadiness nor the page's rhythm.
- **Count the page's pitches over the page.** Three knocks match one note, and
  counted over what was matched every page looked like a page of one pitch.
- **Synthetic notes must ring.** A spiccato note synthesised as 42 ms with a
  40 ms fade-in is bow scratch, not a note, and it made the check look broken
  on fast playing. Real strings ring on after the bow lifts; so must a test's.
- **Speech inside a real take is not solved.** It can still skew timing; a
  per-note pitch filter was measured and did not find the mistimed notes.

### The chain of notes (2026-09-25)

- **A real instrument breaks timing-only matching.** The first real take (a
  double bass) had 105 attacks for 95 notes — bow changes, ringing strings, a
  note heard twice — and `align_dtw`, which gives every attack a note, lost its
  place. `alignment.align_chain` pairs by pitch in order and may leave an
  attack out; it runs only for a take under `warn_quality`.
- **Count trust against the page's notes, never the notes paired.** A pairing
  allowed to skip can pair only what matches; a different tune in the same key
  was 100% "confirmed" that way, and given a verdict.
- **Read a bass's pitch before its high-pass.** The 80 Hz filter that helps
  the onset detector removes the fundamentals of the bottom octave. And a bass
  sounds an octave below its page: match `midi - 12`.
- **Never place a note through the pairing you are trying to correct.** The
  second pass read where notes belong by interpolating through the first
  pass's pairs, and so kept every arbitrary choice the first made between two
  equal pitches. A running median of their offsets does not.
- **An even rhythm hides a wrong pairing.** A bar played twice scored 0.998
  with 29 of 32 notes paired to the wrong attack; a hold scored 0.966 with the
  first half one note early. Quality cannot see it; pitch can — so the chain
  audits well-read takes too (`_audited_by_chain`).
- **A restart invents notes, twice over.** Check both copies are heard: four
  open strings refused as a replay of bar 4 came straight back as a first try
  at bar 5.
- **Only a pairing made by pitch can say a bar was skipped.** One made by
  timing that lost notes to a live room looks the same.
- **A passage is chosen to fit.** Never trust a share of *its* notes alone;
  hold it to the take's own attacks, and let it choose bars, not override a
  refusal.
- **Count what the chain did not pair.** It leaves out an attack that
  matches nothing, so the pairs it keeps always look well heard; a replay is
  visible in the share of *attacks* heard, not of pairs.
- **A chosen start bar with no note in it moves forward, not to bar 1**
  (`lib/record/startOptions.startBarFor`); the take, Listen and the analysis
  all follow it.
- **Rhythm fits somewhere on a long page by luck.** A fragment matched by
  timing is a prefix of its page (`PREFIX_START_BEATS`); only pitch may place
  it elsewhere. The first re-run of real takes put bar 7 at bars 42–45.
- **Real bass is less "tonal" than synthetic bass.** The chroma heard a pitch
  after 0.59–0.69 of a real bass's attacks, 0.87+ of a synthetic one's. Ask
  the pitch track (`_heard_by_pitch`) before telling anyone they did not play,
  and let the alignment speak for a take it refuses anyway (`not_tonal` only
  fires over `broken_quality`).
- TUNING_LOG.md 2026-09-25 has every number.

## The capture path (2026-08-24) — what an audit of it found

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
- **A blank tile on the shelf has to say which kind of blank it is** (2026-09-17).
  `PieceTile` draws the engraving when there is one and an empty page when there
  is not, so a scan in flight, a scan that failed, a piece typed in by hand and
  a piece whose backend predates the field were one silent rectangle. Nine
  failed ones sat in the owner's library for three weeks, the way out of them
  two screens down in `PieceScoreScreen`. The rule is `lib/library/tileState`
  — four states, in a module because a rule inside a `.tsx` is a rule nothing
  checks — and the unreadable one carries **Try again** and **Discard** on the
  tile. Notation wins over status there, deliberately: a row can carry measures
  and a stale `failed`, and a tile that hid real music behind an error would be
  wrong about the only thing it is for.
- **A failed scan is swept after a week, photographs first**
  (`services/score_archive`, 2026-09-17). It is the same hole as the one below,
  one table along: `POST /v1/scores` claims the page as it writes the row, so
  the unclaimed-upload sweep can never see it, and nothing else ever deleted
  one — 31.7 MB across nine rows on the live project before this existed. No
  mark and no migration, unlike `take_archive`: the row is what gets removed, so
  it cannot be found twice. Rows with an `analyses` or `assignments` reference
  are left alone, and a lookup that fails counts as a reference.

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
  **Migration 014 is applied on the live project and nowhere
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
with nothing in it.** Every fixture build had a library, a take and thirty days
of insights, so Today, Library and Insights were only ever seen populated —
which on 2026-09-02 found Today telling a new musician *"Nothing to practice
yet"* above a fully built daily warmup it was hiding from them.

That used to take five one-line edits to `fixtures.ts` and remembering to
revert them. It is now **one command**: `npm run build:web:empty`, which sets
`EXPO_PUBLIC_FIXTURES=empty` and builds into `dist-empty/`. See
`mobile/README.md`, "An account with nothing in it", for the serve-and-sweep
lines. A ritual with a revert in it is how `.env` gets committed.

A state with no fixture is a state nobody has looked at, and that has
now cost this project **six** times: a guessed clef captioned as read, an
84×154 box of padding where a cover should be, two post-scan screens never
rendered, onboarding asking a returning musician for a photograph their
account already had, `AccountStartupScreen` holding a centred spinner between
two left-aligned sentences with the one button the screen exists to offer at
the vertical middle of the phone (2026-09-01), and the empty Today above.

**The tab bar is fine at 2x text and breaks at 3x** (measured 2026-09-03).
Gaps between the four labels, at 375pt: 48–53pt at 1x, 25–33pt at 1.5x, **2–13pt
at 2x**, and **−27 to −43pt at 3x — they overlap**. Vertically it survives: the
bar stays 75pt at every scale while the label grows from 17pt to 51pt, and the
label's bottom edge goes −17 → −13 → −8 → **0** against the bar's, so at 3x it
is exactly flush and one step from clipping.

`TAB_BAR_ROW_HEIGHT` is computed from **unscaled** tokens, which is why the bar
does not grow — but the slack around the icon absorbs it as far as 3x, so this
is a limit rather than a bug at any size below that. iOS's own tab bars drop to
icons only at accessibility sizes, and this is a **custom** `BottomTabBar`
(`tabBar={(props) => <BottomTabBar {...props} />}`), so React Navigation's
handling is not in play — the app owns it. Hiding the labels above a font scale
is the conventional answer and is `CLAUDE.md` §2.

**A long piece title runs off the screen at large text, and the one-line fix is
a design trade** (measured 2026-09-03). `PageHeader`'s title is `flex: 1`, and
on the web build a flex item cannot shrink below `min-width: auto` — its
*min-content* width, which `overflow-wrap: break-word` does **not** reduce. So
with a real unabbreviated title ("Sonata No. 1 in G minor for unaccompanied
violin, BWV 1001 — Adagio, Fuga, Siciliana, Presto") the title's right edge
against a 375pt screen goes 295 · 373 · 494 · 734 at 1x · 1.5x · 2x · 3x.

`minWidth: 0` removes the overflow at every scale and keeps the trailing action
in the corner instead of dropping it below-left. **It was tried and reverted**,
because it also authorises mid-word breaking everywhere: `screenTitle` is 36px,
so at 2x "Library" has a min-content width of 229pt against a ~175pt box and
renders as **"Lib / rar / y"** — on a far more common screen than a
ninety-character title.

The real constraint is not layout. At 2x the single word "unaccompanied"
measures **481pt**, wider than the whole 335pt content column, so *no* flex
rule can fit it: the only answers are breaking the word, shrinking the type, or
truncating. All three are `CLAUDE.md` §2. Do not apply `minWidth: 0` to `PageHeader.title`
without that decision — the `SearchField` fix that looks identical is **not**
the same case, because an `<input>` scrolls its text rather than wrapping it.

**Every brand asset is still the Expo starter's** (measured 2026-09-03, by
looking at them): `icon.png`, `favicon.png`, the three Android layers and
`public/app-icon.png` are a blue chevron on pale blue with the template's
construction guides — dashed sight lines, two circles and a centre crosshair —
on a product whose identity is warm paper and engraved notation. `icon.png` is
1024×1024, RGB, no alpha, so App Store Connect would take it. **A wrong icon is
not a build failure; it is a build that succeeds and is wrong.**
`tools/check-brand-assets.py` lists them by hash and runs in CI. It does not
fail while they are listed — drawing them is the owner's under `CLAUDE.md` §2 — but it does
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
---

## Signing in, and where the session lives (2026-09-17)

**A sign-in the server granted can still fail in the app, and did.** Supabase's
auth log for 2026-09-17 has three password grants for one address inside twelve
seconds — 05:45:13, 05:45:17, 05:45:25 — each answered `200` with a session,
and the backend's first `/v1/me` at 05:45:26. Nothing returned an error all day.
The musician saw the sign-in form again, freshly mounted and empty, twice. Read
`DECISIONS.md`, 2026-09-17 for the chain; what follows is what to know before
touching any of it.

- **`supabase.auth.getSession()` is a storage read, every single time.**
  `GoTrueClient.__loadSession` re-reads the store on each call — there is no
  in-memory session to fall back on. So every `getAccessToken()`, and therefore
  every authenticated request, depends on the store answering.

- **`AsyncStorage` is IndexedDB on web** (`@react-native-async-storage` 3.x —
  `lib/module/web-module/IndexedDBStorage.js`). There is no deadline anywhere in
  that adapter, and `IndexedDBConnectionRegistry` caches the connection promise
  process-wide: one `open` that never settles wedges every later read for the
  life of the page. The session is therefore **not** kept there.
  `data/auth/sessionStore.ts` uses `localStorage` on web, remembers what it
  wrote, bounds every call, and never rejects. The library cache still uses
  IndexedDB, where the data is large and a failure costs a refetch.

- **Null from a storage read is not a sign-out**, and `apiFetch` still ends a
  session on a null token — which is right, so the null has to be earned.
  `getAccessToken` raises `SessionUnreadableError` when the store has failed and
  produced nothing. Same rule as `backend/app/auth.py`, which answers 503 rather
  than 401 for a key server it cannot reach: *could not check is not the same as
  not valid.*

- **`signInWithPassword` saves the session and notifies its listeners inside
  itself**, and `_notifyAllSubscribers` **rethrows the first error a listener
  threw** — out of the sign-in call. A screen that blows up while being told
  about a session therefore reports that the sign-in failed, over a session that
  exists. This app's two listeners (`useAuthStatus`, `startLibraryCache`) are
  wrapped in `isolatedListener`; anything added beside them must be too.

- **Ask the session, not the exception.** `screens/auth/authAttempt.ts` settles
  a call that threw or stalled by checking whether there is a session, and gives
  every auth call a deadline so a button cannot spin for ever. The rule is in a
  module rather than in `AuthScreen` because there is no React Native testing
  library here.

- **The logs are the only witness.** `mobile/` has no logging facility on
  purpose, so a client-side auth failure leaves no trace on the device. What
  found this was Supabase's `auth_logs` and `edge_logs` (the latter carries the
  user agent — an iPhone on iOS 18.6 here) read next to Render's request log.
  Three grants and no backend request is the signature of the app discarding a
  session, and it is visible from nowhere else.
