# InTempo Decisions

Architectural "X over Y because Z" choices only. Format: date, decision,
alternatives considered, why we picked this. See intempo-combined.md
Operating Principle #5.

---

## 2026-08-24 — Put screen *rules* in testable modules, over adding a React Native testing library

**Context:** A capture-path audit found nine defects, and the four that cost a
musician real work all lived in the same place: a decision taken inside a React
component. Where a photograph goes when the shutter fires. Whether a finished
drag commits. Which page a retake replaces. Every one of them was a branch in a
`.tsx` file, and **not one had a test**, because the mobile tree has vitest and
nothing that can render a component. Twenty-one test files, all of them pure
logic, and the entire capture path — `captureSession`, the scanner, the review
list, the upload screen — with zero.

**Alternative considered: add `@testing-library/react-native`.** It is the
obvious answer and it would test the components as they are. It also means a
jest-vs-vitest decision (RNTL's preset assumes jest; running it under vitest
means a custom environment and a react-native transform), a react-test-renderer
pinned against React 19.2.3, and a mocking surface for `expo-camera`,
`expo-image-picker`, `react-navigation` and `react-native-svg` before the first
assertion runs. The tests it then buys are largely *rendering* tests, and the
defects here were not rendering defects.

**Decision:** the rule moves out of the component into a module with a name, and
the component keeps only what a component is for — layout, and calling the rule.
`captureSession.capture()` decides where a photograph goes; `drag.ts` decides
whether a gesture commits; `transcriptionProgress.ts` already did this for the
progress bar, which is the precedent this follows rather than invents.

**What we accept:** navigation is still untested. `handleRetake` navigating to
the scanner instead of going back is argued in a comment and verified by hand,
not by a test — and that is a real gap, not a solved problem. The wager is that
the *decisions* are where the bugs are and the *wiring* is where they are
visible, which is what these nine findings say: eight of them were decisions.

**What would reverse it:** a defect that a rendering test would have caught and
a rule test would not — a control that stays pressable while its action is in
flight is exactly that shape, and one of the nine (`EmptyState` ignoring
`disabled`) already is. If a second lands, the library is worth the setup.

---

## 2026-09-08 — Mirror `uv.lock`'s versions into the Modal image, over installing from the lock itself

**Context:** `modal_app.py` built its image with the same lower bounds as
`pyproject.toml` — `librosa>=0.11.0`, `numpy>=2.4.6`, `scipy>=1.18.0` — and the
comment above them claimed that "a version that changes an onset by a frame
cannot arrive here without arriving in the tests too."

That is not what a lower bound does. The tests, the six-clip corpus regression
and Render all run what `uv.lock` resolved; a `>=` image resolves to whatever
PyPI holds on the morning it is built. They agree today only because the lock
has not moved off the bounds yet. The first librosa point release would have
given a musician a verdict from an onset detector nothing in this repository
had ever run, and the divergence would have been invisible: same code, same
config, different arithmetic, no error anywhere.

This is not a general reproducibility concern. It is specific to what this
container computes. The whole product is one number per bar — how far a note
sat from where it was written — and that number goes through a resampler, a
decoder, an STFT and a JIT compiler before anybody sees it.

**Decision:** `modal_app.py` pins exact versions, and `test_worker_image.py`
reads `uv.lock` and asserts each pin still matches. `uv lock` upgrading librosa
fails CI rather than shipping. The pinned set is the six direct dependencies
plus **`soxr`, `soundfile` and `numba`** — librosa's, not ours, named nowhere
in `pyproject.toml`, and the three places the samples actually move: `soxr`
resamples every take to 22.05 kHz, `soundfile` decodes it, `numba` compiles the
paths that find the onsets. Pinning librosa and letting its resampler float is
a fence with the gate open.

### Alternatives considered

**Install from the lock — `uv sync` in the image, or an exported
`requirements.txt`.** Strictly more correct: it pins the transitive closure,
not a hand-chosen subset. Rejected on what it costs against what it buys here.
The lock resolves the *whole* backend — `fastapi`, `uvicorn`, `anthropic`,
`google-genai`, `pillow` — and the point of this image is that the container
holding the second copy of the service-role key carries none of that. Getting a
subset out of a full lock means either an export step with its own group
filtering, or a second lockfile for the worker, and a second lockfile is a
second thing that drifts. The mirrored pins keep the image definition a single
readable list, and the test is the part that makes it hold.

**Pin only the direct dependencies.** Simpler, and wrong for the reason above:
`soxr` is not in `pyproject.toml` and moves every sample in the take.

**Leave the bounds and delete the comment's claim.** Honest, and no better —
the drift would still happen, it would just no longer be contradicted in
writing.

### Trade-offs accepted

- **The transitive closure still floats.** Everything `numba`, `soxr` and
  `soundfile` themselves pull in resolves at build time. This is a fence around
  the arithmetic, not a reproducible build, and `modal_app.py` says so in those
  words rather than claiming otherwise a second time.
- **Upgrading a dependency now takes two edits**, `uv.lock` and `modal_app.py`.
  That is the cost of the fence and the test names it explicitly when it fires.
- **Nothing here is verified against a real Modal build.** The versions are
  known mutually consistent because the lock resolved them together on 3.12,
  which is what the image uses — but no image has been built from this file.

## 2026-09-01 (later) — Match on intervals, with position as a saturated tie-break

**Context:** the previous entry in `EDIT_LOG.md` measured a defect in the
product's core claim. A take that holds one bar a beat too long had **48 of its
96 sounds attributed to the wrong written note**, and the app named eight bars
as off-tempo in a performance where one bar was long and the rest was perfect.

The cause is not the search. DTW's cost was the distance between absolute
times, so a take offset from the written grid is cheaper to explain as "they
skipped two notes" (two steps) than as "they hesitated" (0.83 s on each of 88
pairs). A per-skip penalty from 0.1 to 1.5 written gaps barely moves it,
because no penalty bridges 73 seconds.

The user was asked what the app should say and chose **"one bar dragged —
measure against your own pulse"**. Note identity is the prerequisite for that,
and for the grid reading too: today's answer is wrong about *which* notes.

**Decision:** the cost between a detection and a written note is the difference
between their **inter-onset intervals**, plus a **saturated** term for how far
apart they are in the piece.

    cost(i, j) = |interval(i) - interval(j)| + 0.5 * min(|t_i - t_j|, 0.15 * gap)

### Alternatives considered, each measured

**Absolute time alone** — what it replaces. Correct on everything except a
timing disturbance, where it gets half the take wrong.

**Intervals alone.** Offset-invariant by construction, and it fixes identity
completely: 96 right, 0 wrong on both hesitation cases, six corpus clips
unchanged, every unsafe take refused *more* firmly. Unusable anyway: a passage
of equal intervals is a plateau of equal cost, so the path through it is
arbitrary. Quality wandered — a steady take at 110% of the written pace scored
0.682 where 125% scored 1.000. Non-monotone, and both are well inside the
tempo clamp.

**An unsaturated hybrid.** Adding position back at any weight restores the
plateau ordering, and at every weight from 0.25 to 2.0 it also restores the
shift: 27 to 29 sounds still wrong. The absolute error after a hesitation is
0.83 s against an interval error of ~0.01 s, so position wins the argument
whatever it is scaled by. The cap is the whole idea, not a refinement of it.

**A per-skip penalty on the warp path.** Measured across 0.1–1.5 written gaps.
Moves the wrong-note count from 48 to 44. Rejected on arithmetic.

### Trade-offs accepted

- **A take in a different rhythm is now analysed rather than refused**, when it
  rescales onto the written one. Long-short-short against straight eighths went
  from 0.000 to 0.700; dotted pairs from 0.000 to 0.754. This is the same
  tolerance that lets a hesitating musician keep their bar numbers, and it
  cannot be had separately. It is arguably the better answer — someone playing
  dotted where straight is written played the right notes and wants to be told
  where the rhythm went, not that the app could not hear them — but that needs
  a real recording and an ear to settle. Pinned by a test either way.
- **Two constants that are not in `config.toml`**, with `MIN_TEMPO_RATIO` and
  the gap-core bounds, for the same reason: they bound what the matcher may
  believe rather than expressing a threshold about playing.
- **A cost matrix is built explicitly**, O(N×M): 19 MB at 1536 notes. librosa
  built the same matrix internally from the feature rows, so this is not new
  memory — and it is *faster*, 83 ms against 145 ms at that size.
- **The cap sits between two mild failures**, 0.12 (a genuinely dropped note
  costs one neighbour) and 0.20 (seven wrong on a hurried bar). Every value in
  between is far better than the 48 it replaces, so the choice inside that
  window is not delicate; it is 0.15 because that is the middle of it.

---

## 2026-09-01 — Measure the played tempo with a clipped mean, not a median

**Context:** the matcher rescales a recording toward the score's pace before
comparing them, so that deciding *which* onset is which note does not depend on
how fast it was played. The scale was `median(diff(detected)) /
median(diff(expected))`, clamped.

Onset times are quantised to the analysis hop — 23.2 ms at the configured rate
— so a median of intervals snaps to a multiple of it. Eighth notes written
416.67 ms apart come back as a uniform **418.0 ms**, exactly 18 frames. The
0.3% that rounding invents is inaudible and unplayable-around, and it
accumulates: past half a note gap the warp path gives back a whole note at
once, leaving two parallel ramps with a step between them — a shape no straight
line can remove, so the residual measure of "can this be trusted" explodes.

    128 notes   drift 162 ms   quality 0.986
    256 notes   drift 324 ms   quality 0.761   ← half a gap is 208 ms
    768 notes   drift 995 ms   quality 0.759

`warn_quality` is 0.7. Any session past roughly 150 notes was heading for
"results may be inaccurate" because of arithmetic, on a take played perfectly.

**Decision:** the median picks the centre; the mean of every gap *near* it
supplies the precision. Gaps outside 0.6×–1.6× of the median do not count.

### Alternatives considered, each measured

**A plain mean.** Unbiased, and it fixes the length bug completely — zero
residual drift at every length tested. It also believes a musician who stopped
to turn a page slowed down for the whole take: one 6-second pause in sixty
eighth notes moves the estimate from 417 ms to 510 ms. A pause is not a tempo.

**A trimmed mean, by rank.** The obvious robust average, and wrong here in a
way worth writing down: the gaps carrying the correction *are* the minority.
The distribution is mostly 18-frame gaps with a few 17-frame ones, and it is
exactly those few that pull the average off the grid. Trimming 25% from each
end restored the median's answer to five significant figures. Measured across
eighths at 72 BPM, quarters at 60 and sixteenths at 100: median 324/209/5875 ms
of drift, rank-trimmed 324/209/119, clipped **0/0/0**.

**Refining the ratio from a second alignment pass.** Implemented, measured, and
removed. It works, but it corrects a symptom: the first pass's mapping is
already contaminated by the slip it is meant to detect, and it costs a second
DTW per candidate. Fixing the estimator makes the slip not happen.

**Keeping the median and widening the DTW band.** Not tried, because the drift
is real: the sequences genuinely disagree by a note by the end, and a wider
band lets the path wander further rather than removing the reason it must.

### Trade-offs accepted

- **Two more constants** (`_GAP_CORE_LOW`, `_GAP_CORE_HIGH`) that are not in
  `config.toml`. They sit with `MIN_TEMPO_RATIO` and `MAX_TEMPO_RATIO`, which
  are also in code, for the same reason: they bound what the *matcher* may
  believe, rather than expressing a threshold about playing. Nothing about a
  room or an instrument should move them.
- **A piece of mostly-one-note-value gets a sharper estimate than a rhythmically
  varied one**, because the core band is narrower relative to its spread. The
  same statistic runs on the written timeline, so the ratio stays right; only
  the precision varies.
- **The estimate is still a single number for the whole take.** A musician who
  genuinely changes tempo halfway is described by one pace here — which is
  correct for *matching*, and is not the verdict: `compute_deltas` works in
  real seconds and reports the change.

---

## 2026-08-31 — Record the tolerance thresholds on the analysis, not serve them from config

**Context:** two charts in the app — the per-measure deviation bar and the
take's trend line — draw a take against the pipeline's *outer* threshold, the
point beyond which a deviation is called severe. Both held their own
`const FULL_SCALE_PCT = 20`, copied from `backend/config.toml`. `DeviationBar`
documented the copy as temporary: *"Server-tunable, which this copy is not.
When the API exposes the thresholds it should come from there."*

The six thresholds are the values in this system most certain to change —
`config.toml` calls them "starting values; tune per instrument/room", and
`TUNING_LOG.md` exists solely to record their movement. They are also
asymmetric by design (dragging sits wider than rushing), so a single client
number is wrong on at least one side as soon as tuning begins.

**Decision:** the analysis result carries the thresholds it was judged by.
`AnalysisResult.tolerance` is filled from the config in force during the run,
on every status, and travels to the client inside `result_json`.

### Alternatives considered

**A `GET /v1/config/tolerance` endpoint, or the thresholds on `/v1/me`.** The
obvious reading of the comment the code left, and wrong. It answers "what are
the thresholds *now*", but every chart is drawing a take from the *past* — a
take judged by whatever was in force when it ran. Re-scaling stored takes
against today's numbers would redraw a musician's practice history after a
tuning pass they had no part in and no way to see. Worse, the bar's length
would move while the word beside it — which comes from the stored band — did
not, so the same take would contradict itself on screen. Also a second request
on a path that has one.

**Keep the client copy, add a test asserting it matches `config.toml`.**
Cheapest, and it would catch drift in CI. It fails for the same reason: even
kept in sync it answers the wrong question, because "current" and "what this
take was judged by" diverge the moment anything is tuned. It also cannot
express asymmetry with one number.

**Recompute the bands client-side from the thresholds.** Rejected on the
existing precedent in `getInsights`, which already takes the band "of the take
nearest the mean, rather than a band computed here: the thresholds are the
server's and they move." Classification stays in one place; the client only
learns the scale it should draw against.

### Trade-offs accepted

- **The field is nullable, and permanently.** Analyses already in the table
  have no `tolerance`, so `lib/tempo.ts` keeps one fallback — the shipped
  default of 20, which is genuinely what those rows were judged by. Removing
  it later needs a backfill, not a schema edit.
- **A tuning pass no longer redraws history**, which cuts both ways: two takes
  in one Insights window can have been judged by different thresholds. The
  window reports the tolerance of the take that set its headline band, matching
  how the band itself is already chosen, rather than pretending one set covers
  the window.
- **The trend line takes a single scale where the bar takes two.** A polyline
  crossing zero has to stay straight; independent half-scales would bend a
  steady drift at the origin and read as a change in the playing. It uses the
  wider of the two, so nothing clips and the tighter side reaches full height a
  little early. The bar has no such constraint — it is discrete and
  centre-anchored — so it uses the correct threshold per side.
- **Six floats on every result.** Negligible against `per_note`, and they make
  each row self-describing: a stored take can be re-plotted correctly years
  later without knowing what the config said that week.

---

## 2026-08-27 — Store the instrument on an analysis, not a `double_bass` flag

**Context:** `services/analysis.analyze()` has taken a `double_bass` keyword
since Batch 3 — a high-pass filter and a lower onset-detection threshold, both
there because the low register is where finding note attacks is hardest. No
caller had ever set it. `analysis_runner` called
`analyze((y, sr), score, target_bpm)` and the flag defaulted false, so the
entire low-register path was dead code in an app whose spec names double bass
as its initial instrument focus (§1, line 59). Every bass player had been
analysed with thresholds tuned for treble strings.

Wiring it up required deciding where the value comes from and what shape it
takes in the database.

### Where the value comes from

**A `Instrument` preference the app already had, over a new field on the
score, and over inferring it from the clef.**

- **Infer from `score_json.clef`.** *Rejected, and it is the tempting one.* A
  bass part is in bass clef — but so is a cello part. A cello's low C is around
  65 Hz, under the 80 Hz high-pass, so treating the two alike would filter away
  the fundamental of exactly the notes a cellist most needs heard. The clef is
  a property of the page; the instrument is a property of the player.
- **A field on the score.** *Rejected.* It asks the same question on every
  piece a person adds, to answer something that changes for almost nobody.
- **The `Instrument` preference.** *Chosen.* It already exists, already
  includes `double_bass`, already has a picker in Profile, and already decides
  which clef the daily warmup is written in. It had simply never left the
  phone. No new UI, no migration for the user-facing part, and the answer is
  given once.

### What the column holds

**`instrument text` over `double_bass boolean`.**

The boolean is smaller and is what the pipeline actually reads today. It is
still the wrong column, because it stores a *conclusion* rather than a *fact*,
and this particular conclusion is unsettled: the spec asks for a **high-pass**
filter in one place (line 2490) and a **low-frequency boost of 80–300 Hz** in
another (line 1281), which are opposite treatments of the same band. Which is
right needs real recordings and a musician's ear — it is a `TUNING_LOG.md`
question, not a code one.

A column holding the instrument survives that being decided. A column holding
today's interpretation would need a backfill the moment it changed, and could
never answer "how did the cellists do" at all, because the answer was thrown
away at write time.

**Nullable, no default.** A row written before the column existed was analysed
without anyone saying what the instrument was, and "we do not know" is the
honest value. Defaulting to `violin` would record a guess as a fact.

**Trade-off accepted:** the runner now does a string comparison
(`row["instrument"] == "double_bass"`) where a boolean read would do, and the
mapping from instrument to pipeline settings lives in code rather than in the
data. That is the point — it is the part expected to change.

---

## 2026-08-25 — Keep photograph-first transcription, and build the correction step it always assumed

**Context:** after several failed scans the owner asked whether the whole
approach was wrong — "is there any other solution, why is OMR so hard, or are
you just being dumb?" Four alternatives were designed and then adversarially
verified against the code. Three of the four did not survive verification, and
the investigation found something better than any of them.

### What the analysis actually consumes

`pitch` appears **once** in the entire timing pipeline —
`alignment.py:99`, as `note.pitch == "rest"`. There is no pitch detection in
the audio layer. The spec agrees: *"onset is what we care about, not pitch"*
(§7, line 1146), and pitch-accuracy analysis is explicitly out of scope
(line 563).

That looks like grounds for asking a model for rhythm only. It is not — see
below.

### The alternatives, and why three failed

- **Rhythm-only OCR (drop pitch from the ask).** *Rejected.* The premise is
  wrong: reading a duration means locating and segmenting every notehead, stem,
  flag and beam, and **that localisation is the expensive part — pitch rides
  free on it.** Once the notehead is found, its staff position is a lookup.
  Dropping pitch removes an output field, not a perceptual step. It saves ~33%
  of output tokens (not the 75% first estimated, and most of that was already
  won by compacting the JSON) and costs Listen playback, the engraved stave,
  any future note-correction editor, and chroma-augmented DTW — which the spec
  lists as a **v1** onset-recovery mitigation (§7.5 line 1326), not a V3 idea.

- **Score-free grid timing (onsets vs. a metronomic grid).** *Rejected, and
  decisively.* Nearest-grid snapping cannot measure the thing this app
  measures: past half a grid spacing it **assigns a large rush to the previous
  grid point and reports it as a drag** — the sign inverts — and sustained
  drift wraps into a confident "steady tempo". It also cannot name a measure,
  which is the product (`build_timeline` gets `measure_number` off the score,
  `alignment.py:107`). Worst of all its errors are *silent*: a wrong verdict
  with no page to check it against, where OCR's errors are visible on a page
  the musician is looking at.

- **MusicXML/MIDI import.** *Worth building, but not as claimed.* The idea that
  it yields a "perfect timeline" is **false against the converter as it
  stands**: `musicxml.py` is first-part-only, ignores `<backup>`/`<voice>`,
  cannot represent tuplets in the `Duration` enum, and neither reads nor
  expands repeats. It also sets confidence to 1.0 by construction, which would
  quietly convert a system that admits uncertainty into one that does not.
  Hardening it is ~2–3 days; tuplets are a breaking schema change across
  `score_schema.py`, `alignment.py` and five mobile files.

### The finding that decided it

**The spec's own mitigation for unreliable OCR was never built.**

The spec does not claim OCR is accurate. It books the inaccuracy and answers it
with a correction step, listed as an MVP feature (line 447):

> Score preview & edit | User confirms parsed score; can tap to fix wrong
> notes/rhythms | **OCR will miss things; user must be able to correct without
> re-shooting**

and again at line 1136 — handwriting accuracy "~70–80%… we surface low
confidence and **rely on user correction**".

That step does not exist. `PATCH /v1/scores/:id` already accepts a corrected
`score_json` (`routers/scores.py:103`) and `UpdateScoreInput` already declares
the field (`mobile/src/data/api/scores.ts:75`) — **the backend half is done and
nothing in the app ever sends it.** A grep for any note-editing UI returns zero
hits.

So every misread is currently terminal. The design assumed a musician could fix
a bar in ten seconds; without that, a single wrong duration means re-shooting
the page or abandoning the piece.

**Decision: keep photograph-first transcription, and build the score-correction
step.** It is the smallest change that makes an admittedly-unreliable input
usable, it is the one MVP feature the spec required and the build skipped, and
half of it already exists. Add MusicXML import afterwards as a *third*
provenance beside camera and manual entry — after hardening the converter, and
without letting it claim a confidence it has not earned.

**Trade-off accepted.** OCR stays imperfect and stays the primary path, so the
correction UI must be genuinely fast — tapping a duration, not a notation
editor. If correction turns out to be needed on most bars rather than a few,
the spec's own open question (§13 #6, line 1866) says that is the signal the
experience is broken, and MusicXML import becomes the primary path instead.

---

## 2026-08-22 — The pipeline shows its evidence by default, not on request

**Context:** the staff reader has now been wrong six times. Every one of those
versions reported healthy numbers. Five were caught by rendering something and
looking at it; none was caught by a metric.

The last one is the clearest case. `residMedian ±2.19px` was quoted in a commit
message as proof the grid fitted, while the grid was actually 70px — nearly two
staff spaces — off the printed staff at one end. The metric was not lying: it
measures how well the curve agrees with the columns the curve itself selected.
It cannot fall, because rejecting the columns that disagree is a step in the
algorithm. **A number computed from the data a model selected cannot falsify
that model.**

**Decision: the bench renders the evidence for every stage, inline, as the work
happens — and the model's reasoning is streamed alongside it.**

**Alternatives considered.**

- *A debug flag.* Evidence you have to opt into is evidence nobody looks at
  until they already suspect something. Every one of the six defects was found
  by looking at a picture; in four of those cases I only rendered the picture
  after a metric had already convinced me the stage was fine.
- *Better metrics.* Worth having, and one was added — the fit is now checked
  against an unanchored per-column search rather than against its own inliers.
  But the reason that check exists is that a picture showed the problem first.
  Metrics are how a known failure is prevented from returning; they are not how
  an unknown one is found.
- *Log to the console.* The evidence here is images. A histogram, an overlay and
  a mask are the whole point, and the console cannot show them next to the
  sentence that explains what they are for.

**Why this one.** The bench's purpose is to make a claim about accuracy
checkable. A run that prints only its conclusion can be believed or disbelieved;
one that shows its working can be checked. The first time the trace ran it
caught a bug that four previous "verified" runs had missed — which is the
argument for it, made without being asked for.

**Trade-offs accepted.**

- Rendering full-resolution masks and overlays inline costs memory and makes the
  page long. Acceptable: this is a bench, and scrolling past evidence is cheaper
  than not having it.
- Streaming needs a hand-written SSE reader for both providers, because the
  bench is one file with no SDK. About sixty lines, shared between them.
- Thinking is billed as output. It stays behind a checkbox, off by default,
  matching the backend — the bench measures that assumption rather than
  quietly departing from it.

---

## 2026-08-22 — Barlines are read by the model, not detected by image analysis

**Context:** stage 1b cuts a photographed staff into enlarged per-measure
slices. That needs measure boundaries. Six ways of finding barlines in the
image were built and measured against a real phone photo of a bass part:

| Approach | Why it failed |
|---|---|
| Column ink coverage ≥ 0.9 | Real barlines scored 0.75–0.89; raising the bar let stems through |
| Coverage along a leaning column | Recovered the real ones and admitted three stems with them |
| Neighbouring ink within ±1 space | Barlines 0.16–0.23, stems 0.24–0.33 — overlapping, no threshold |
| Row-wise stroke width | Barlines 0.11–0.26, stems 0.16–0.27 — no separation at all |
| Overhang above and below the staff | Barlines 0.13–0.26, stems 0.16–0.19 — inverted, if anything |
| Connected components | One slur runs the whole system; eight barlines and forty noteheads come back as a single blob 2000px wide |

Every one of these is a locality assumption, and a page of real music breaks
locality: slurs cross barlines, beams cross stems, a stem whose notehead sits
on an outer line spans the staff exactly as a barline does.

**Decision: the model finds the barlines; the CV prints a ruler so it can say
where they are.**

**Alternatives considered.**

- *Keep tuning the detector.* Barline detection is a known-hard OMR subproblem
  and the failures above are not near-misses — they are the same numbers for
  both classes. More thresholds would fit this one photograph.
- *Fixed overlapping windows, no boundaries at all.* Robust, but it gives up
  measure-aligned crops, and measure alignment is what makes the beat-sum
  validator able to say which measure is wrong.
- *Ask the model for pixel coordinates.* It guesses. Coordinates are not
  something a vision model reads; printed numbers are.

**Why this one.** It splits the work along the grain of what each side is
actually good at. Locating five parallel lines on a curved page to sub-pixel
precision is arithmetic, and the model cannot do it. Seeing that a vertical
stroke is a barline rather than a stem is recognition, and the CV cannot do it.
The ruler is the interface between them: the CV prints numbers, the model reads
one off, and neither has to do the other's job.

**Trade-offs accepted.**

- A barline pass costs a request. It is folded into the slice reads rather than
  run separately, but the slices are read one at a time, so stage 1b costs
  roughly one request per twelve ticks of staff instead of one per page.
- A model that misreads a tick puts a boundary in the wrong place, and nothing
  downstream catches it except the beat-sum validator noticing the measure does
  not add up — which is the same signal that catches a misread note.
- The stroke candidates are still computed and passed along as an advisory
  hint. They are cheap, and a hint that agrees with the model is weak evidence
  the boundary is right.

---

## 2026-08-20 — A field with no column is either given one or deleted, decided by whether a fact exists behind it

**Context:** the UI rendered two fields that no database column backed —
`progress` and `movement`. Both came from the fixture data and both were
hardcoded `null` in `sources/api.ts`, so both were invisible on any real
account. They were the same *kind* of defect and got opposite treatments, which
is worth writing down so the next one is not decided by whichever is less work.

**Decision: `progress` was deleted; `movement` was given a column.**

The test is not "is this field used" or "would users like it". It is **is there
a fact behind it that something can produce.**

- **Progress**: a percentage through a piece. Nothing in the system can compute
  it. There is no notion of a piece being "80% learned" in the score, the
  analyses, or anything a musician tells the app. Any value would have been
  invented, and a progress bar that moves for reasons the user cannot predict
  is worse than no progress bar. Backing it with a column would have meant
  inventing the number in a new place rather than deleting the fiction.
- **Movement**: "I. Adagio". The musician already knows it, three forms were
  already asking for it, and the value was being typed and then dropped on the
  floor. The fact existed; only the storage was missing.

**Alternative considered — leave `movement` fixture-only until a batch needs
it.** Rejected because the cost is not deferred, it is transferred: every
screenshot, demo and test showing a movement was showing something the product
could not do, and the forms were quietly discarding what people typed. A field
that accepts input and silently drops it is worse than one that is absent.

**Alternative considered — infer the movement from the title.** Rejected. "No.
28" in a title is sometimes a movement and sometimes the piece; guessing wrong
mislabels a musician's own library, and the correct value is one field away.

**Trade-off accepted:** one more nullable column and one more field on three
forms. Nullable is the honest default — most music the app will see has no
movement at all, and null says that where an empty string would not.

---

## 2026-08-17 — The fixture/live switch is derived from the environment, not declared in code

**Context:** every screen read from a `PieceSource`, and `sources/index.ts`
chose between the fixture and API implementations with `const USE_FIXTURES =
true`. Turning the app on meant editing that line and pushing.

**Decision: `IS_LIVE_BACKEND` is computed from the presence of
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and
`EXPO_PUBLIC_API_BASE_URL`. There is no flag to flip.**

The constant was a loaded gun. `api/client.ts` defaults its base URL to
`http://127.0.0.1:8000`, and nothing hosts the backend, so flipping the flag
and pushing would have shipped a Cloudflare site whose every screen failed
against a host that exists only on a developer's laptop. The failure would have
looked like a backend outage rather than a build-configuration mistake.

Deriving it removes the class of error entirely: a build that was given a
project and a host runs live, one that wasn't runs on sample data, and
`.env` being gitignored makes "wasn't" the default for CI and Cloudflare.

**`EXPO_PUBLIC_API_BASE_URL` is checked for explicit presence, not
truthiness** — because of that localhost default. "No backend was named" and
"the backend is at the default" are different claims and only the raw
`process.env` read distinguishes them.

**The auth gate follows the same predicate.** `useAuthStatus` used to ask "are
the Supabase vars set", which is a *nearly* identical question. The gap is a
state that can really occur — credentials but no API host — in which the old
code demanded a sign-in and then served fixtures: a gate guarding data that
wasn't the account's. `isAuthConfigured()` was deleted rather than kept
alongside; two predicates that agree almost always are worse than one, because
the disagreement is exactly where the bug lives.

**Alternatives considered:**

- *Keep the boolean, add a build-time check.* Still leaves the deploy correct
  only as long as someone remembers the check.
- *A separate `EXPO_PUBLIC_USE_FIXTURES` flag.* An independent switch that can
  contradict the other three — "live, but with no host" becomes expressible,
  and that is precisely the state worth making unrepresentable.
- *Runtime health probe of the API.* Honest, but it makes the app's data source
  depend on network conditions, so the same build shows different libraries on
  a flaky connection. Configuration should not be discovered.

**Trade-off accepted:** a developer who sets only some of the three vars gets
sample data with no in-app explanation. `describeFixtureReason()` names the
missing variable for the console, which is where that reader is looking.

## 2026-08-17 — A piece can exist without a photograph

**Context:** `scores.source_image_url` was NOT NULL, and `POST /v1/scores`
required an image it could run OCR over. Every route into the library went
through a readable photograph.

**Decision: `source_image_url` becomes nullable, and `POST /v1/scores` accepts
either an image *or* a hand-entered clef, time signature and tempo.**

One provenance was an assumption, not a requirement. A handwritten part, a
library copy under a bad lamp, or a piece someone is working from a book they
would rather not photograph all need to be in the library, and none of them
yields an image OCR can read. It is also the only route in that needs no
camera, no OCR provider and no API keys — which makes it the route that still
works when the rest is misconfigured.

**NULL rather than a sentinel string** (`""`, `"manual"`, `"none"`): a sentinel
makes every reader of the column responsible for knowing which strings are real
URLs, and `_object_key_from()` already returns None for anything that isn't a
storage URL, so NULL flows through the display-signing path with no special
case.

**Both halves at once is an error, not something to reconcile.** A body with an
`image_url` *and* a `clef` is rejected rather than having the manual fields
silently ignored. A caller sending both has misunderstood something, and
overwriting what OCR read off the page with what a human guessed is the worse
of the two outcomes.

**`ocr_confidence` is NULL for a hand-entered piece, not 0.** The column asks
how well OCR read the page. For a page that was never read the answer is "it
didn't", which 0 — meaning "read it, understood nothing" — states wrongly. The
`score_json`'s own `ocr_confidence` stays 0.0, because that field is required
by the schema and no notes were read.

**Trade-off accepted, and surfaced in the UI:** a piece created this way has no
measures, so the analysis pipeline has nothing to align a recording against and
cannot produce a verdict. It can be opened and practised with the metronome.
The form says so under the button rather than letting a musician discover it
after recording a take. The alternative — a manual note-entry editor — is a
notation editor, which is a product in itself.

## 2026-08-17 — One dark surface on Today, and it is the warmup

**Context:** the owner asked for the warmup to become a page you open, with a name and a Start button on Today, and said Today "looks kind of bland". Three treatments were put to them — an ink panel, notation bare on the page, and a bordered study-book plate. They chose the ink panel.

**Decision: the warmup panel is a full-bleed band in `actionBg`, and it is the only dark surface on the screen.**

Today ran card → type → more type, with a single visual event in the whole screen. A second one was needed, and the warmup is the right thing to be it: an inverted surface says *this is a different kind of thing from the piece above it* far more efficiently than another heading would.

**No new colours.** `actionBg` / `actionText` / `onDarkMuted` already exist, and the palette file already describes them as doubling for full-bleed dark surfaces — the camera scanner uses the same three. This is the established dark treatment applied somewhere new, not a style invented to make a screen interesting.

**Full-bleed rather than inset.** Inset by the gutter it would read as a very dark *card*, which is the one thing the palette notes say this colour must not become, and Today already has a card.

**The notation is the only ornament, and it is real** — the actual opening bars of the actual warmup, engraved, in cream. Nothing was added to make the panel interesting. §3 law 10 cuts both ways: if a decorative mark can be removed without loss, it should never have been drawn.

**Alternatives considered:**

- *Notation bare on the ivory.* The quietest option and entirely defensible, but it would not have answered the blandness — it is more of the same surface.
- *A bordered plate.* Structure from borders, which the design laws prefer in general. Rejected here because Today would then have two bordered boxes stacked, and the second would read as a weaker copy of the first.

**Trade-off accepted:** Today now has two focal points where §3 law 4 asks for one. They are sequential rather than competing — a card you read, then a surface you notice — but it is a real tension, and if the screen starts to feel busy the panel is what gives way, not the card.

> **Reversed the same day.** The owner read the band as competing with the card, not following it, and they were right — the trade-off above was rationalising a defect rather than accepting a cost. The warmup is now plain notation on the page background at the foot of the screen, and the panel gave way exactly as this paragraph said it should. What survives from this decision is the reasoning about *where* dark surfaces may be used, not the claim that Today needed one.

**Also decided: `TempoStepper` is extracted rather than duplicated.** The warmup page needs the same control the Record screen has. Two steppers that quietly disagree about their step size or their limits is the kind of drift nobody notices until a musician does.

## 2026-08-17 — A daily excerpt, and an engraver that refuses to draw a clef

**Context:** the owner spotted that "Last take" was effectively a second copy of the practice card. They were right, and by construction rather than by coincidence: `apiPieceSource.getCurrentPiece()` resolves the piece by taking the **newest analysis** and returning its score, and `getLatestTake()` returns that same analysis. Against the real backend the two blocks name the same piece every time. The fixtures had hidden it by disagreeing with each other — `fixturePieceSource` returned the first fixture piece while the fixture take belonged to a different one, which is a fixture bug and is now fixed.

**Decision: the verdict sentence moves onto the card**, and the freed block becomes a daily excerpt chosen by the musician's instrument. The owner asked for a term and a fact together, plus "based off the musical instrument they play, a short excerpt they can choose to practise every day".

**Decision: `instrument` is a local preference, not account data.** It picks the clef and range of the excerpt and will pick the reference voice. None of that belongs to the backend, and it follows `metronomeMode` and `haptics` into `preferences`.

**Decision: the excerpts are hand-authored, four sets of three, one per instrument** — not transposed from a single set.

- *Automatic transposition was the obvious alternative and is wrong.* Transposing a violin exercise down for cello puts it on strings a cello does not have, and a "first position" exercise that needs a shift is not a warm-up. The corpus is checked by test against each instrument's written first-position range.
- *Slicing four bars out of the musician's own library* was the other alternative. Rejected: it lands mid-phrase, needs whatever technique the piece needs, and hands back a fragment of what they are already practising.

**Decision: the excerpt can be heard but not recorded.** A take is analysed against a score row in the backend, and an exercise the app authored has no such row. A "record" button here would either fail or quietly analyse against the wrong music. Better absent than dishonest — and `Listen` already gives the reference the exercise actually needs.

**Decision: the engraver draws no clef.**

A clef is calligraphy. A hand-approximated treble clef in an app for classical musicians would be the first thing a reader noticed and the last thing they forgave, and I am not able to author a good one as an SVG path.

**Alternatives considered:**

- *The Unicode glyphs `𝄞 𝄢 𝄡`.* Rejected: they land on the system font stack, and Android frequently has no glyph — a tofu box in the middle of a stave is worse than no clef at all. The same reasoning applies to `♯`, which **is** drawn, as four strokes.
- *Bundling a music font (Bravura is SIL OFL).* The correct long-term answer, and deferred rather than rejected. It is ~500 KB of asset for one glyph per excerpt today, and asset paths in this build have already cost one blank-page incident.
- *Drawing the clefs anyway.* Rejected on quality.

Instead the note names are printed under the staff, the way a study book does for a beginner, and the block names the instrument it is written for. That is honest about being an exercise diagram rather than pretending to be engraved sheet music.

**Superseded in part, later the same day:** the owner removed the daily term, keeping only the fact. The reasoning below about the fact corpus still stands; the term's "read it off your own score" argument is now history, and the code for it is in git rather than in the app.

**Trade-off accepted:** the fact corpus is 24 entries and repeats after about a month. That is why it is a footnote at the bottom of the screen rather than a feature of it. Every entry is a settled statement of record — anything that needed a "probably" was left out rather than hedged, because a wrong fact about Bach in an app for classical musicians is expensive.

## 2026-08-17 — Today keeps its card; what sits under it must give a reason

**Context:** the cardless Today from earlier today was rejected by the owner — "I don't think this is a good today. Keep the continue practice in a box like you did last time." Fair: stripping the card removed the resemblance to Library but left a screen with one piece, one sentence and a lot of air. Bare was the original complaint and the redesign had made it worse.

**Decision:** the practice card comes back and stays the only card on the screen, and content goes underneath it. But the previous decision's finding still holds — *a list of pieces on Today is the Library tab with fewer rows* — so it needs a rule, not just restraint:

> **Nothing on Today may name a piece without saying why it is on the screen.**

Every row carries its reason as the line under the title: "Rushing across 12 sessions", "Not practiced yet", "Today · You rushed across measures 5 to 8". A row that only names a piece is a list; a row that gives a reason is a suggestion. The old library preview failed this rule, which is why it read as a duplicate of Library, and it is now written down so the next person adding to this screen has a test to apply.

Two consequences follow mechanically:

- **The rows carry no thumbnail.** A sheet crop beside a title *is* the Library row. The card above already carries the score image.
- **Nothing may be named twice.** The piece in the card, the piece in the last take, and the two suggestions are all deduplicated against each other. "60 Studies" appearing as both the take you just finished and a piece worth a look is two true statements that read as one bug.

**Decision: `getLatestTake()` goes on the `TakeSource` seam** rather than being derived from `PracticeInsights` on the screen.

**Alternatives considered:**

- *Reuse `insights.pieces` for the last take.* Rejected — it cannot answer the question. `PracticeInsights` is a thirty-day aggregate; "how did last time go" is about one recording, and the two would silently disagree the moment a musician's last take differed from their month.
- *A new backend endpoint.* Unnecessary. `GET /v1/analyses` already returns the caller's own analyses for Insights; the adapter sorts what it already fetches and settles the ordering client-side rather than assuming the server's.
- *Skeletons for the suggestion blocks too.* Rejected: each block hides itself when its data is absent, so a placeholder would promise content that may never arrive — on a new account, three of the four blocks are correctly empty forever until the pipeline runs.

**Trade-off accepted:** Today now fires four queries (`current piece`, `library`, `insights`, `latest take`) where it fired two. On fixtures that is free; against the API it is two extra round trips on the app's first screen. Worth watching, and the fix if it bites is a single aggregated endpoint, not fewer blocks.

## 2026-08-17 — Today and Library get different compositions, not different content

**Context:** the owner said Today felt bare and that it and Library "don't look much different". Putting the three tabs side by side showed why, and it was worse than the report: **all three were the same composition.** A serif title, then a vertical stack of white rounded cards, one per piece, each carrying a title, a composer, a gold horizontal bar and a grey metadata line. Today's bottom two-thirds was literally the top of Library, three rows shorter, drawn by the same `PieceCard` component.

Two things fell out of the comparison that nobody had reported:

- **The gold bar meant three different things.** Progress through the piece on Today and Library; signed deviation from the beat, diverging from a centre tick, on Insights. Same colour, same weight, same width. One encoding for "how far through" and "how far off".
- **The progress it encoded does not exist.** `sources/api.ts` maps `progress` and `movement` to null and says why: *"no progress concept anywhere in the schema"*. Against the live backend every piece loses its percentage, its bar and its movement line — so the screens do not get less bare when the API lands, they get **more** bare and **more** identical.

**Decision:** differentiate by composition, not by adding content. Today became one piece with no card at all; Library became a grouped index with no cards either.

- **Today**: greeting demoted to the eyebrow, the piece promoted to the 36pt title. The library preview deleted outright. A full-bleed sheet-music strip, the piece's own recent verdict from `PracticeInsights`, the working tempo from `practiceTempo`, and the action pinned to the footer.
- **Library**: rows grouped by recency under quiet headings, separated by hairlines, no cards, no bars. Searching flattens the groups.

**Alternatives considered:**

- *Add content to Today — a streak, a session count, a week strip.* Rejected. Today wasn't short of things, it was short of a reason to be its own screen; a counter would have been decoration on top of a duplicate. It also drifts towards the gamification the brief rules out.
- *Group the Library by composer.* Tried on paper and rejected against the actual data: a violinist's library is mostly one piece per composer, so it produced a heading for nearly every row. Recency groups meaningfully **and** answers what a library is opened to answer — what have I not touched in a month.
- *Keep the cards and just change the spacing.* Rejected: the sameness was the card, not the gap between them.
- *Fix only the gold bar.* Rejected as too small — it is a real defect, but the screens would still have been the same screen.

**Trade-off accepted:** Today now shows exactly one piece, so there is no way to start a different one without going to the Library tab. That is one extra tap for a case the tab bar already serves, and it buys a screen with a single focal point. If it proves wrong, the fix is a "choose another piece" control, **not** the return of the preview list.

**Also decided: progress stops being displayed on these two screens.** Not deleted from the type — the field stays, and `PieceDetail` still renders it — but Today and Library no longer show a percentage or a bar that the backend cannot produce. As a side effect the gold bar now means one thing in the tab bar's reach: deviation, on Insights.

## 2026-08-17 — Two clocks for the metronome, not one

**Context:** the metronome has three outputs — a row of marks on screen, a haptic tap, and a click. The obvious build is one beat clock fanning out to all three. It is wrong for one of them.

Anything the screen draws or the phone vibrates is already bounded by the frame rate and by how fast a hand can feel a difference; a few milliseconds late is imperceptible. A click is not. The ear places a transient an order of magnitude more finely than the eye places a change, and a metronome that wobbles is worse than none because a musician will play the wobble — into a take this app then measures for timing errors and attributes to them.

**Decision:** `clock.ts` is a drift-corrected JS timer and drives the visual and haptic modes. `click.web.ts` ignores it entirely and books clicks against `AudioContext.currentTime` with a lookahead window, which is the standard Web Audio scheduling pattern. The two run independently, which is safe because `metronome_mode` is an enum — never more than one output at a time.

Both compute a beat's time as `start + index × period`, never by adding a period to the last beat. Accumulating would lose a fraction of a millisecond per beat and be a quarter of a second out by the end of a two-minute take: the app would be measuring its own error and billing it to the player.

**Alternatives considered:**

- *One JS clock for all three.* Rejected on the measurement, not on principle. Booked against the audio clock, click-to-click error came back at exactly 0 seconds. A JS timer driving the same clicks would have carried the scheduler jitter straight into the reference a musician is playing to.
- *Schedule the whole take's clicks up front,* as `scorePlayer.web.ts` does for a piece. Rejected: a take can run fifteen minutes, which is over 1,300 oscillator nodes held for the duration, and the take can be stopped at any moment. The lookahead window books a quarter-second at a time and closing the context takes the rest with it.
- *A native scheduling module,* so the device build gets the same guarantee as the browser. Deferred, not rejected — see the trade-off.

**Trade-off accepted:** the native click path (`click.ts`) re-strikes two pre-rendered `expo-audio` players from the JS clock, so **on a device the clicks inherit JS-thread jitter that the web build does not have.** That is written at the top of the file. It cannot be measured in this environment — there is no simulator or device — so what it needs is a person with headphones judging whether the jitter is audible. If it is, the fix is a native scheduler, not a faster timer.

**Also decided: no count-in.** A take is aligned against the score by what was played, not by when the file starts, so an offset at the top costs the analysis nothing. A count-in the recorder captures as silence is a product feature with its own UI, and inventing one inside a clock module is how features arrive that nobody chose.

## 2026-08-17 — Rewrite exported asset paths after the build rather than vendoring the fonts

**Context:** the first Cloudflare Pages deploy of the mobile app rendered a blank page. The build log was clean end to end and ended `Success: Assets published!`. The cause was in the log the whole time, as a number: `dist` holds 27 assets, `Uploaded 12 files`, and exactly 15 files sit under a directory called `node_modules`.

**Cloudflare Pages silently skips anything under `node_modules` in the build output.** Metro names an exported asset after the path of the module that imported it, so a font from `@expo-google-fonts` lands at `dist/assets/node_modules/@expo-google-fonts/inter/400Regular/Inter_….ttf`. All four typefaces 404'd. `useFonts` never resolved, and `App.tsx` gated the entire app on `fontsLoaded` behind a plain ivory `<View>` — so the app rendered a blank screen, forever, because of a decorative resource.

**Decision:** a post-export step (`mobile/scripts/flatten-vendor-assets.mjs`) renames `dist/assets/node_modules` to `dist/assets/vendor` and rewrites the references in the bundle. Wired into `npm run build:web`, which the root build script now calls, so local and CI cannot drift.

**Alternatives considered:**

- *Copy the four fonts into `mobile/assets/` and import them from there.* Rejected: it fixes the fonts and leaves the eleven `@react-navigation/elements` icons still unreachable, so the same failure returns the next time any dependency ships an asset. It also means the typefaces stop being managed by `@expo-google-fonts` and start being four binaries someone has to remember to update.
- *A Metro config knob.* There isn't one. The destination path is derived from the importing module's location and there is no supported way to change it.
- *Leave it and accept missing fonts.* Rejected — that was the bug.

**Trade-off accepted:** we string-rewrite a built artifact, which is the kind of thing that breaks quietly when the upstream format changes. Mitigated by the script failing loudly: if it moves files but rewrites zero references, it exits non-zero, because a rename without a rewrite produces exactly the failure it exists to prevent and would otherwise look like success.

**Separately, and worth keeping even if the above becomes unnecessary:** `App.tsx` no longer waits forever. `useFonts`'s error is honoured and a 5-second timeout backs it up, so a font that 404s or hangs costs the typeface and not the interface. Verified by forcing every `.ttf` to 404 and confirming the app still renders.

## 2026-08-16 — Patch `expo-audio` rather than fork or replace it, to get an unprocessed input source on Android

**Context:** `AudioStream` is right on iOS — it opens the session in `.measurement` mode, so the system applies no input processing. On Android it opens `AudioRecord` on `MediaRecorder.AudioSource.MIC`, which is the general-purpose source and passes through the OEM's input chain. Automatic gain is the specific problem: it reshapes attack envelopes, and attack envelopes are what the onset detector measures. Android takes would have been quietly less accurate than iOS ones with nothing anywhere saying so.

**Decision:** `patch-package`, on one function in `AudioStream.kt`.

- The source becomes `AudioSource.UNPROCESSED` where the device reports `PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED`, and `VOICE_RECOGNITION` where it does not. `MIC` is no longer used at all.
- On top of the source, `AutomaticGainControl`, `NoiseSuppressor` and `AcousticEchoCanceler` are explicitly disabled on the capture session, because some devices attach them regardless of the source asked for. The effect objects are retained for the life of the stream and released on stop — an `AudioEffect` that is garbage collected takes its setting with it.

**Alternatives considered:**

- *A local Expo module replacing `AudioStream` for Android.* Rejected: it means owning `AudioRecord`, its capture loop, its buffer marshalling and its lifecycle to change one constant, and diverging from upstream's bug fixes forever.
- *An Expo config plugin rewriting the Kotlin at prebuild (`withDangerousMod`).* Rejected: the same string-matching fragility as a patch, with none of a patch's tooling — no clean-file diff, no loud failure when upstream moves.
- *Leaving it and documenting it.* Rejected. This was the state after the previous entry, and it puts a known measurement error into a measurement app.

**Trade-off accepted:** a patched dependency has to be re-made on every `expo-audio` upgrade. `patch-package` fails the install loudly when the context no longer matches, which is the behaviour worth having — a silent revert here would mean thresholds tuned against processed audio. The patch is small, self-contained, and worth sending upstream.

**Not verified.** There is no Android toolchain in this environment, so this Kotlin has never been compiled, let alone run against a microphone. What is verified is that the patch applies cleanly to a fresh `npm install`. The first real Android build is the test, and it should be a build before it is a take.

## 2026-08-16 — Capture takes as raw PCM through `AudioStream` and a web `AudioWorklet`, not through either platform's recorder

**Context:** the mobile app needed real audio capture. The analysis pipeline measures note onsets — where an attack begins, to within milliseconds — and every decision below follows from that one requirement.

**Decision:** record raw PCM on every platform and write the WAV in the client.

- **Native:** `expo-audio`'s `AudioStream`, not its `AudioRecorder`. The stream delivers untouched int16 buffers on both platforms and reports the rate the hardware actually gave.
- **Web:** an `AudioWorklet` over `getUserMedia`, not `MediaRecorder`, with `echoCancellation`, `autoGainControl` and `noiseSuppression` all explicitly false.
- **Both:** one shared encoder, `lib/audio/wav.ts`, so the file the backend receives is byte-identical in structure whichever platform produced it.

**Alternatives considered:**

- *`expo-audio`'s `AudioRecorder`.* Rejected. It wraps `AVAudioRecorder` on iOS and `MediaRecorder` on Android, and Android's has no raw-PCM output at all — the best available is AAC. Lossy codecs smear exactly the transient the onset detector reads, so Android would have been the quietly-degraded platform with nothing in the interface to say so.
- *`MediaRecorder` on web.* Rejected for the same reason: Opus in WebM on Chrome, AAC in MP4 on Safari, both lossy, neither optional.
- *Resampling to 22.05 kHz in the client,* which is the rate the pipeline loads at. Rejected. It would roughly halve upload size, but it moves an irreversible step onto a browser resampler of unknown quality when the server already does it with soxr. The WAV header carries the true rate, so the server gets it right from any device. We pay bandwidth to keep the one lossy step on the machine we control.

**Correction, same day.** This entry originally recorded an open gap on iOS: that system auto-gain could not be turned off because `expo-audio` exposes no way to reach `AVAudioSession`'s `.measurement` mode. **That was wrong, and it was wrong because it was inferred from the JavaScript type surface rather than read from the shipped native source.** `AudioStream.start()` in `node_modules/expo-audio/ios/AudioStream.swift` opens every stream with `session.setCategory(.record, mode: .measurement)` — exactly the mode that asks the system for no input processing. iOS was already correct.

Reading the Android source in the same pass turned up the gap that does exist: `AudioStream.kt` creates its `AudioRecord` on `MediaRecorder.AudioSource.MIC`, the platform's general-purpose source, which runs through whatever the OEM's input chain applies. See the entry below.

Uncompressed audio also costs upload: mono 16-bit at 48 kHz is 96 KB a second, so a three-minute take is about 17 MB. Accepted as the price of a measurable signal. A 15-minute cap (`MAX_TAKE_SECONDS`) bounds memory; when it bites, the "Listening back" screen says so rather than truncating quietly.

## 2026-07-28 — Stay on Supabase; keep object storage swappable so audio can move to R2 later

**Context:** the user asked whether Supabase is the right backend before investing further. Worth noting the framing: Supabase is *not* "the backend" — it supplies auth, Postgres, and object storage. The analysis engine (librosa + DTW, Batch 3) is a separate Python/FastAPI service that no BaaS can host, and that split is unchanged by any vendor choice.

**Decision:** stay on Supabase for auth + Postgres + storage. It fits this workload specifically: the data is relational (users → scores → analyses → per-measure/per-note), RLS enforces per-user isolation at the database for what is genuinely private data (people's practice recordings), and JWKS/ES256 auth + presigned uploads are already built and tested (Batch 1).

Separately, and per the user's own instinct: **plan for audio blobs to move off Supabase Storage** (most likely Cloudflare R2, zero egress) if bandwidth costs bite. Audio files are large and re-fetched on every analysis, so egress is the realistic cost pressure — not storage volume.

**The seam already exists — preserve it, don't pave over it:**
- `workers/analysis_runner.download_audio(url)` is a plain `httpx.get`. It is provider-agnostic *today*. **Do not** replace it with a Supabase SDK call; that would be the single most damaging change to future portability.
- All storage signing goes through one function, `routers/upload._sign_upload(bucket, object_key)`. Keep new signing logic there rather than inlining SDK calls at call sites.
- Known friction if/when the move happens: bucket names `"audio-uploads"` / `"score-images"` are string literals in a couple of modules, and `routers/scores.py` validates score-image URLs against a Supabase-shaped URL pattern.

**Alternatives considered:**
- *Firebase.* Rejected: Firestore's document model fits this relational data badly, and the Python analysis service would still be separate.
- *Clerk + Neon + R2 ("best of breed").* Rejected for now: genuinely good, and Clerk's auth UX beats Supabase's, but it's three vendors and three integration surfaces for a pre-launch solo build.
- *Convex.* Rejected: TypeScript-first and wants application logic in its own functions; awkward against a Python DSP pipeline.
- *Hand-rolled auth on plain Postgres.* Rejected: weeks rebuilding magic links, sessions, and token refresh — the canonical thing not to hand-roll.
- *Refactor storage behind an abstraction layer now.* Rejected: speculative work for a swap that hasn't happened, and it contradicts operating principle "don't optimize early." The natural seam above is sufficient; revisit when there's a real bill to look at.

**Trade-off accepted:** we're carrying a known future migration rather than pre-solving it. That's deliberate — the app has not yet run end-to-end even once, so egress cost is a projection, not an observation. Re-architecting ahead of that evidence would trade working, tested code for a hypothesis.

---

## 2026-07-28 — Badge: adopt the kit-style `variant`/`appearance`/`shape` API, but resolve it to the locked palette with non-generic defaults

**Context:** the user flagged that the verdict badges "look ai" — correctly. The old `Badge` was a pastel-tinted pill with a small coloured status dot: the single most templated status affordance on the web (GitHub labels, Linear, every Tailwind kit), a `bg-*-100/text-*-800` reflex, with a dot that only repeated the text colour. The user then supplied a shadcn-style badge API as the target shape: `variant` (primary/success/warning/info/destructive) × `appearance` (solid/light/outline) × `shape` (circle/square).

**Decision:** implement that full API surface, but (a) resolve every variant to the locked manuscript tokens rather than a generic status ramp, (b) default to `appearance="outline"` + `shape="square"` — an engraved chip on paper-warm with a hairline edge, the hue carried by text and border rather than a colour fill — and (c) drop the decorative status dot entirely. `tone` ("on"/"mid"/"bad") is kept as a verdict-UI shorthand that maps onto `success`/`warning`/`destructive`, so verdict screens stay in domain language.

**`info` resolves to neutral graphite `ink`, never `spruce`.** Spruce is the recording *environment* surface only and must never encode a status (the rule in `tokens.ts`); a green-blue "info" badge would quietly break that quarantine. Future sessions: do not "fix" this by reaching for spruce.

**Alternatives considered:**
- *Keep the pill + dot and just recolour it.* Rejected: recolouring doesn't remove the tell — the shape and the redundant dot *are* the tell.
- *Replace badges with pencil margin-marks or Italian tempo terms* (`stringendo` / `a tempo`), which is more distinctive and more musician-native. Not taken now: the user asked for the kit API, and these would fight it. Still the better long-term direction for verdict UI specifically — revisit when verdict badges actually ship on a screen.
- *Ship only the outline appearance.* Rejected: `solid`/`light` are legitimately useful (a solid amber badge reads well on the spruce surface), and the user explicitly asked for the appearance axis.

**Trade-off accepted:** the API can still express the generic look — `appearance="light" shape="circle"` reproduces close to the pastel pill we just removed. That's deliberate: the defaults guide toward the manuscript direction without forbidding the escape hatch. The guard is the default, not a restriction. Also, `Badge` is currently used *only* on `/showcase` — no live screen consumes it yet, so this was a free rework.

---

## 2026-07-24 — Frontend design tokens: adopt the "manuscript" direction, superseding spec §5's placeholder palette

**Context:** spec §5 (Batch 5) specifies design tokens as "Cream `#fbf4de`, ink `#1a140a`, gold `#8a6212` … same theme as the AP Euro work." That was a placeholder to get the dev moving. Over this session the user explored the visual direction in depth (a ChatGPT moodboard, several interactive prototypes, two design-taste skills), and converged on a distinct "engraver's manuscript" identity.

**Decision:** lock the frontend design system to the manuscript direction, not §5's placeholder: Paper Ivory ground, Rosined Amber as the single interactive accent, Deep Spruce as the recording-environment surface only, a verdict triad (green/amber/oxblood) quarantined to verdict UI and always paired with a label, Playfair Display display serif + a grotesque body (system SF standing in for Suisse Int'l until licensed), radii 10/14/20/26, warm shadows with a lit-edge hairline, and the `cubic-bezier(0.32,0.72,0,1)` "iOS" easing. Tokens live in `frontend/src/styles/tokens.ts`, mirrored as CSS variables in `index.css` and mapped into Tailwind.

This also refines §3.5: §3.5's original "quarantine the verdict colors" rule is kept, but the palette/type themselves evolved (warmer, serif-led) past §3.5's Geist/Linear-leaning starting point. The anti-collision rules are documented in the prototype and the token file.

**Alternatives considered:**
- *Use §5's cream/gold placeholder verbatim.* Rejected: the user explicitly evolved the design beyond it; §5 itself framed the palette as a familiar-to-the-dev starting point, not a mandate.
- *Wait and hard-code colors per component.* Rejected: that's exactly the "every element re-decides taste" failure mode. One token layer is what keeps the UI coherent.

**Trade-off accepted:** the checked-in spec (`intempo-combined.md`) still shows the old palette in §5; the source of truth for *implementation* is now `tokens.ts`. The human owns folding this back into their spec copy if they want the doc to match.

---

## 2026-07-24 — `alignment_failed`/`no_onsets` are DB `status='done'`, not `'failed'`

**Context:** `analyze()` returns a graceful `AnalysisResult` with an internal `status` of `ok`, `alignment_failed`, or `no_onsets` — it does not raise on a bad recording. The DB `analysis_status` enum is `queued/processing/done/failed/failed_recoverable`. The worker has to map one to the other.

**Decision:** any result `analyze()` *returns* (all three internal statuses) is stored as DB `status='done'`, with the pipeline status carried inside `result_json.status`; `alignment_quality` and `finished_at` are set so the DDL's `CHECK (status <> 'done' OR result_json IS NOT NULL AND finished_at IS NOT NULL)` holds. DB `status='failed'` is reserved for *exceptions* — audio couldn't be fetched, score missing, internal error. The client reads `result_json.status` to decide between showing the verdict, a low-confidence caveat, or a "we couldn't match / couldn't hear it, re-record" prompt.

**Why:** an alignment that's too poor to report is still a *successful analysis* — we ran the pipeline and produced a truthful "can't tell" answer. Conflating that with a server failure would (a) lose the quality score and re-record guidance the UI needs, and (b) make `failure_reason` do double duty for "your recording was unusable" and "our server broke." Keeping the two axes separate keeps each field meaningful.

**Alternatives considered:**
- *Map `alignment_failed` → DB `failed`.* Rejected: throws away `alignment_quality`, and the UX for "re-record, we couldn't match it" is different from "something broke, retry."
- *Add new enum values.* Rejected: the DDL is treated as fixed from the build side (same stance as the Batch 1 FK decision); `result_json.status` already carries the nuance without a migration.

---

## 2026-07-24 — Compressed-audio decode (AAC/m4a) depends on ffmpeg in the deployed image

**Context:** the mobile client uploads AAC/m4a (spec §4 — ~2 MB vs ~10 MB WAV). `load_audio_bytes` spills the storage blob to a temp file and calls `librosa.load`. librosa decodes WAV/FLAC/OGG via `soundfile` (bundled libsndfile), but AAC/m4a falls through to the `audioread` backend, which shells out to **ffmpeg**.

**Decision:** treat ffmpeg as a deployment dependency of the backend image, not something the app code can guarantee. Unit tests use WAV so CI needs no ffmpeg. Flagged here and in EDIT_LOG so that "m4a analyses fail in prod but pass in CI" is a one-grep answer, not a mystery.

**Follow-up (not done this batch):** add ffmpeg to the backend Dockerfile / buildpack, and consider transcoding to WAV at upload time (or having the client upload WAV for the short calibration clip) if the ffmpeg dependency proves fragile.

---

## 2026-07-24 — Alignment quality = timing-fit × coverage, with lead-in latency removed

**Context:** Batch 3 needs a single 0..1 `alignment_quality` (spec §7) that gates the "show a warning" (<0.7) and "refuse to report" (<0.4) paths. The obvious metric — normalize the raw DTW path cost — is wrong in two ways.

**Decision:** compute quality as `timing_quality × coverage` where:
- `timing_quality` scores the residual per-note timing error **after subtracting the median detected-minus-expected offset**, so a constant recording lead-in (reaction time before the first note) counts as zero error. A player who starts 200ms after tapping record but then plays perfectly is a 1.0.
- `coverage` = fraction of expected notes actually matched. This catches the degenerate case timing-alone misses: one perfectly-placed onset against an 8-note score scores 1.0 on timing while 7 notes went unheard. Weighting by coverage flags a "played two bars then stopped / wrong page" take as broken.

Separately, `compute_deltas` anchors its origin on the **first matched onset** (not the median), so gradual drift shows up as a growing per-note delta — which is exactly what the rolling trend and verdict key on. Quality and deltas deliberately use different origins because they answer different questions (shape-fit vs. drift-from-start).

**Alternatives considered:**
- *Raw normalized DTW cost.* Rejected: dominated by the constant lead-in offset (a clean take scored ~0.2 and tripped the "broken" gate in testing) and blind to coverage.
- *Median-offset removal for deltas too.* Rejected: it would center a uniformly-rushed performance into "half drag, half rush" and erase the very drift we're trying to report.

**Trade-off accepted:** the quality curve's one magic number (0.5 beats of average residual error = quality 0) lives documented in `_quality_from_cost`; it's a starting anchor meant to be re-shaped during the tuning loop, not a claim of correctness.

---

## 2026-07-24 — Synthetic click-track fixtures for Batch 3 unit tests; real-recording tuning deferred

**Context:** the Batch 3 DoD lists "all 10 real fixture recordings produce reasonable verdicts." That is a human-ear judgement against real audio, and the tests need to run in CI with no WAVs checked in.

**Decision:** split the two concerns. Unit tests use programmatic click-track fixtures (`audio_helpers.synth_click_track`) with attacks at times we control exactly — these deterministically pin down *pipeline correctness* (onset counts, expected-onset math, DTW mapping, band boundaries, verdict runs, graceful failure). The *threshold-tuning* half of the DoD — is `delta=0.07` right, are the bands where a musician's ear puts them — is explicitly left to the tuning loop and `TUNING_LOG.md`, because it can't be answered without the real six-clip corpus.

**Alternatives considered:**
- *Check real recordings into the repo as test fixtures.* Rejected for now: binary bloat in git, and they'd still need the human-ear pass to be meaningful. Belongs with the tuning corpus, not the unit suite.
- *Claim the DoD is fully met.* Rejected — dishonest. The pipeline is correct; the numbers are untuned. EDIT_LOG and TUNING_LOG say so plainly.

---

## 2026-04-26 — `public.users.id` references `auth.users(id)` ON DELETE CASCADE

**Context:** the canonical DDL in spec §2 (rev 14) declares `public.users.id uuid PRIMARY KEY DEFAULT gen_random_uuid()` with no FK to `auth.users(id)`. During Batch 1 live verification we deleted a Supabase auth user via `auth.admin.deleteUser` and observed the corresponding row in `public.users` was orphaned, with no integrity check forcing `public.users.id` to map to a real auth user.

**Decision:** add `003_users_auth_fk.sql` — drops the `gen_random_uuid()` default on `public.users.id` (it was never used; ids always come from `auth.users.id`) and adds `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`. Standard Supabase pattern.

**Alternatives considered:**
- *Defer to Batch 12 (teacher tier).* Rejected: every batch built on top inherits the orphan-row hazard, and downstream tables (`scores`, `analyses`, `assignments`) all CASCADE off `public.users.id` — they'd accumulate ghost data tied to deleted auth users.
- *App-level cleanup sweep.* Rejected: trades referential integrity for a polling job that has to stay correct forever. The DB constraint is bulletproof and free.
- *Update the spec itself.* The user owns the spec — they can fold this back into their own copy. We're treating spec rev 14 as immutable from the build side.

**Production note:** the migration's leading `DELETE FROM public.users` is safe in dev (table is empty by construction) but destructive in production. Production adoption requires a backfill step (validate every `public.users.id` matches an `auth.users.id` first, then add the FK without the DELETE). Not in scope for Batch 1.

---

## 2026-04-26 — Verify Supabase user JWTs via JWKS / ES256, not HS256 shared secret

**Context:** spec §Batch 1 and the auth-middleware code stub assume Supabase signs user access tokens with HMAC-SHA256 and a shared secret available at Project Settings → API → JWT Settings → "JWT Secret". `app/auth.py` was originally written that way: load `SUPABASE_JWT_SECRET` from env, `jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")`.

**What we hit:** the user's freshly-created Supabase project ships under the *new* asymmetric signing system. There is no HS256 shared secret to copy. `GET <SUPABASE_URL>/auth/v1/.well-known/jwks.json` returns an ES256 (Elliptic-Curve P-256) public key with a `kid`. The "JWT Secret" field that the spec references no longer exists; what looks like one in the dashboard is the JWKS `kid` (a UUID identifying which public key to use), not a signing secret. Tokens issued by `supabase.auth` for end users are signed with the corresponding ES256 private key on Supabase's side, and clients verify with the public key from JWKS.

**Decision:** verify user JWTs via `PyJWKClient` against the project's JWKS endpoint, accepting `algorithms=["ES256", "RS256"]`. Drop `SUPABASE_JWT_SECRET` from the env surface entirely. Keep `audience="authenticated"` (the #1 silent-failure pitfall).

**Alternatives considered:**
- *Stay on HS256 + shared secret.* Would require the user to ask Supabase support to flip the project to legacy HS256 mode; not always possible on new projects, and a one-way street back to the old design.
- *Manually fetch and cache the JWKS ourselves.* Reinvents PyJWT's `PyJWKClient`, which already caches in-process. No upside.
- *Verify with the symmetric service-role JWT secret* (since the legacy service-role JWT is HS256-signed). The shared secret behind that token is not the same as the user-token signing key in the new system, so this doesn't actually work; we tested it.

**Trade-offs we accepted:**
- One extra HTTP fetch on first verification per process (the JWKS call). PyJWKClient caches indefinitely; on a hot path it's free.
- JWKS fetch failure becomes a 401 path. Acceptable — if Supabase's auth server is unreachable we'd fail anyway.
- Tests now mint real ES256 tokens with a generated keypair rather than HS256 tokens with a string secret. Slightly more setup; honest decoder coverage.

**Implementation:** see `backend/app/auth.py` (`_get_jwks_client`, `_decode_token`) and the `_stub_jwks` autouse fixture in `backend/app/tests/conftest.py`. `cryptography` is now a dev dep (also already a transitive runtime dep through `pyjwt`).

**Affected code paths:**
- `app/auth.py` — full rewrite of `_decode_token`.
- `app/config.py` — `SUPABASE_JWT_SECRET` removed from `Settings`.
- `backend/.env.example` — env slot removed; comment explains why.
- `backend/.env` (local, gitignored) — env slot removed locally too.
- `app/tests/conftest.py` — generates ES256 keypair, exposes `make_token` + `bad_token` fixtures, autouse-stubs `auth._jwks`.
- `app/tests/test_auth.py`, `test_me.py`, `test_upload.py` — switched to `make_token` fixture; new test `test_signature_from_wrong_key_returns_401` exercises the wrong-key rejection path that the previous HS256 secret-mismatch test couldn't cover meaningfully.

**Reversibility:** if a future project ever runs in HS256 mode, swap `_decode_token` back to use a secret loaded from env. Tests would need their own corresponding swap. Estimated ~30 min round-trip.
