# InTempo Audio Tuning Log

Populated during Batch 3. Format spec: see "Batch 3 Tuning Appendix"
in intempo-combined.md. Every threshold change logs old value, new
value, regression results across all six fixture clips, and rationale.

---

## 2026-08-30 — The whole corpus passes for the first time. No thresholds changed.

`config.toml` untouched. One correctness fix in `build_timeline`.

### Regression, all six clips, before → after

| clip | status | quality | expected | detected | worst dev |
|---|---|---|---|---|---|
| 01 détaché clean | ok → ok | 0.988 → 0.988 | 32 → 32 | 32 | 20.1 ms |
| 02 rushing | ok → ok | 0.988 → 0.988 | 32 → 32 | 32 | 256.8 ms |
| 03 dragging | ok → ok | 0.988 → 0.988 | 32 → 32 | 32 | 233.9 ms |
| **04 slurred** | **failed → ok** | **0.196 → 0.990** | **32 → 8** | 8 | — → 18.5 ms |
| 05 open E | ok → ok | 1.000 → 1.000 | 1 → 1 | 1 | 0.0 |
| 06 pizzicato | ok → ok | 0.990 → 0.990 | 16 → 16 | 16 | 20.1 ms |

Five clips are bit-identical. The sixth had never passed.

### Why it could never pass

`build_timeline` emitted an expected onset for every non-rest note, **including
the notes inside a slur**. A slur is one bow stroke: the notes under it are not
attacked and no onset will ever be detected for them.

`04_slurred` writes 32 notes, 8 of which are bow changes. The detector found
**all 8** — a perfect reading — and quality is weighted by coverage, so it could
not exceed 8/32 = 0.25. It scored 0.196 and reported `alignment_failed`.

Slurred playing could not be analysed at all, and slurring is not an edge case
on a bowed instrument. The clock still advances for those notes; only the
expectation of hearing them is dropped.

### The trade, stated plainly

A musician who bows every note separately against written slurs now produces 32
attacks against 8 expected, and **fails** where it previously produced a
verdict. Same for a page whose slurs the model invented.

That is a real cost and it is accepted for two reasons. It is a genuine
mismatch between the page and the playing — the spec files detecting those as
V2 — and the alternative was that the correct, common case never worked. The
failure is now told apart from a wrong page and says so: *"We heard every note
the score expects, and a lot more besides — this usually means the slurs on the
page aren't the ones you played."* Sending someone to re-photograph a score that
is fine would have been the worse error.

### An alternative measured and rejected

Computing quality *after* fuzzy matching, over the pairs that survive it, would
have removed the cost — détaché-against-slurs recovers from 0.000 to 0.750. It
also lets a **wrong piece** through: 32 random onsets scored 0.100 before and
**0.698** after, above the 0.4 broken threshold and nearly at the 0.7 warn line.
Fuzzy matching discards whatever does not fit, and eight points that fit a line
can always be found among thirty-two random ones. Not adopted.

---

## 2026-08-29 — Novelty bake-off. Flux kept. No thresholds changed.

**A negative result, and the corpus could not have produced a positive one.**
`config.toml` untouched.

The audit asked whether complex-domain or phase-based novelty (FMP C6S1) beats
librosa's spectral flux on the soft attacks a bowed double bass produces —
replace only if it wins under the same regression clips. It does not win.

Reproducible: `cd backend && uv run python ../tools/novelty-bakeoff.py`. The
four novelty functions are the FMP reference implementations written out in that
file rather than a `libfmp` dependency.

### The six clips cannot decide it

Hits / spurious against **the times the generator actually placed**, swept over
`delta` 0.02–0.2:

| clip | flux (current) | energy | phase | complex |
|---|---|---|---|---|
| 01 détaché clean | 32/0 | 32/0 | 6/27 | 32/0 |
| 02 rushing | 32/0 | 32/0 | 8/25 | 32/0 |
| 03 dragging | 32/0 | 32/0 | 3/30 | 32/0 |
| 04 slurred | 8/0 | 8/0 | 3/13 | 8/0 |
| 05 open E | 1/0 | 1/0 | 1/1 | 1/0 |
| 06 pizzicato | 16/0 | 16/0 | 4/13 | 16/0 |

Flux, energy and complex are **all perfect on all six**. Nothing beats 100%, and
that is the honest reading: these are click tracks with hard attacks, and the
comparison is about soft ones. The fixtures are at ceiling.

**A methodology error caught mid-experiment, recorded because it would have
inverted the conclusion.** The first run scored every clip against the
*metronomic* timeline, which made flux look poor on 02 and 03 — clips that drift
**on purpose**. It was measuring the drift, not the detector. Ground truth is
now reconstructed from `make_synthetic.py`'s own placement.

### Attack softness, which is the actual question

A 41 Hz bass tone, twelve notes, attack time constant swept. Hits of 12 /
spurious:

| method | 5 ms | 20 ms | 40 ms | 80 ms | 150 ms | 250 ms |
|---|---|---|---|---|---|---|
| **flux (current)** | 12/5 | 12/4 | 12/4 | **12/2** | **12/2** | **12/2** |
| energy | 12/0 | 12/1 | 12/3 | 12/3 | 12/3 | 8/7 |
| phase | 1/4 | 1/4 | 1/4 | 0/6 | 0/6 | 0/6 |
| complex | 12/3 | 12/3 | 11/4 | 9/6 | 6/7 | 4/9 |

**The hypothesis is refuted, and by the method it was about.** Complex-domain
novelty degrades *fastest* as the attack softens — 12 → 9 → 6 → 4 — while flux
holds every note and sheds spurious ones. On reflection the mechanism is
obvious: complex-domain novelty predicts steady state and measures the
deviation, and a very slow attack **is** close to steady state frame to frame,
so it spreads thin instead of peaking. Flux integrates magnitude increase, which
accumulates. Phase-based novelty is unusable throughout.

**Recommendation: keep `librosa.onset.onset_strength`.** No change made.

### What this does not say

Synthetic tone: no bow noise, no rosin, no vibrato, no room. It says which
method degrades first on a modelled attack, not what any of them do on a bow.
Re-run the tool when real recordings land — that is when it becomes evidence.

And it points elsewhere: the sweep over `delta` moved almost nothing, which is
consistent with the ±464 ms peak-picking window (2026-08-27 §2) being what
actually limits detection, not the novelty function. **The window is still the
first thing to attack with real clips.**

---

## 2026-08-28 — Matching made tempo-invariant. Regression across all six. No thresholds changed.

**Not a threshold change.** `config.toml` is untouched. Two correctness fixes in
the alignment and onset layers, regression-checked against all six clips as the
rule requires.

### Regression, all six clips, before → after

| clip | status | quality | detected | worst dev |
|---|---|---|---|---|
| 01 détaché clean | ok → ok | 0.988 → 0.988 | 32 → 32 | 20.1 → 20.1 ms |
| 02 détaché **rushing** | ok → ok | 0.872 → **0.988** | 32 → 32 | 256.8 → 256.8 ms |
| 03 détaché **dragging** | ok → ok | 0.872 → **0.988** | 32 → 32 | 233.9 → 233.9 ms |
| 04 slurred | failed → failed | 0.247 → 0.196 | 8 → 8 | — |
| 05 open E long | ok → ok | 1.000 → 1.000 | 1 → 1 | 0.0 → 0.0 |
| 06 pizzicato | ok → ok | 0.988 → **0.990** | 16 → 16 | 20.1 → 20.1 ms |

No status changed, no onset was gained or lost on any clip, and every worst
deviation is identical — the *measurements* are untouched. The two clips that
improved are exactly the two the change was aimed at.

### 1. Matching ran on absolute seconds, so rushing broke it

DTW compared raw times with a euclidean metric. A uniform tempo difference
makes the absolute gap grow along the piece, so the cheapest warp path is not
note-to-note but one that **slides** — further the deeper in. Measured on takes
played at a steady but different tempo, fraction of notes matched to the right
written note:

| | 2% fast | 5% fast | 10% fast |
|---|---|---|---|
| 32 notes | 78% | 31% | 16% |
| 64 notes | **39%** | 16% | 8% |

A musician who rushes is the entire audience for this app, and their notes were
being attributed to the wrong bars. Above ~5% the alignment failed outright and
told them to check they were on the right piece.

Each sequence is now put on its own unit span before matching. **Deciding which
onset is which note cannot depend on how fast it was played; deciding whether it
was early or late must** — and only the first is changed. `compute_deltas` still
works in real seconds, so the verdict reports the rushing the matching ignores,
which is pinned by a test.

Quality now removes a best-fit *line* (offset and rate) rather than a constant
offset. A tempo difference is a ramp, not an offset, so the old residuals grew
with the **square** of the take's length — 64 notes at 1% drift scored 0.514 and
quality had become a measure of how long the piece was.

By span, not by a tempo ratio from median inter-onset intervals: IOI scored
better on a wrong-piece take (0.000 vs 0.248) and much worse on the case that
actually harms someone — a take with every other note missing gets rescaled
until it looks complete, and a dropped-notes performance comes back as a
confident analysis of bars that were never played. Span keeps the real
correspondence and scores it 0.30, which fails honestly.

### 2. The recording beginning was being heard as a note

Onset strength is spectral flux; at the first frames the STFT compares against
its own zero-padding, and the step from padding into the room's noise floor is a
large positive flux. It fired at **0.070 s on every take with any noise floor at
all** — three frames in, at 41% of the envelope maximum — and only a signal
starting in perfect digital silence escaped it. That is why all six fixtures
missed it and why every real recording would have had it.

Being first, it became the alignment origin. On a dead-on-time bass take it
displaced the first note and produced *"You dragged across measures 3–4 by an
average of 59 BPM"* for someone playing perfectly.

The `n_fft // hop_length` frames the padding reaches — 93 ms — are silenced.
Bounded deliberately: the corpus's own clicks start at 200 ms, and a test holds
that a note there is still heard.

### Still open, and still needing a real instrument

- **The ±464 ms peak-picking window**, unchanged, still capping quarter notes at
  ~128 BPM. See the 2026-08-27 entry.
- **Noise-triggered false onsets.** With the deterministic boundary artifact
  gone, what remains is `delta` against a real room's noise floor. On a
  synthetic take with a long noise-only tail it still fires spuriously, and one
  spurious onset at an *end* skews the span the matching normalises by. This is
  the first thing the recordings will settle, and `06_pizzicato` will argue
  against raising `delta` because string ring is the opposite failure.
- **04_slurred cannot pass as things stand.** `build_timeline` emits an expected
  onset for every non-rest note including slur interiors, which produce no
  attack — 8 detectable attacks against 32 expected onsets caps coverage at
  0.25, and quality is coverage-weighted. Pre-existing, unchanged by today, and
  a design question rather than a threshold: the timeline and the detector
  disagree about what counts as an onset.

---

## 2026-08-27 — Dry run against a real-format file. No thresholds changed.

**Not a tuning result.** Preparation for one. The corpus is still six synthetic
click tracks; nothing here was measured on an instrument.

What was done: a 48 kHz **stereo 24-bit** file — the format an interface or a
phone actually produces — was dropped in as `01_detache_clean.wav` to walk the
path a real recording will take, then deleted. The synthetic clips are all
22.05 kHz mono, which is exactly what the loader wants, so resampling and
downmixing had never once been exercised. They work: librosa resolved 48k
stereo 24-bit to 22.05k mono without complaint, and `load_corpus` picked the
real file over the stand-in automatically.

Three things surfaced. One is fixed; two are for the session with real clips.

### 1. Fixed — the recording's clock was never put on the score's clock

`build_timeline` returns "seconds since start of the first note".
`detect_onsets` returns seconds since the **recording** started. Nothing
reconciled them before DTW, so a musician who tapped record, picked up the bow
and then played was compared against a score assuming they began instantly.

Measured on a perfectly played take — pure arithmetic, no audio, no fixture:

| lead-in | alignment quality |
|---|---|
| 0.5 s | 1.000 |
| 1 s | 0.908 |
| 2 s | 0.762 |
| 3 s | 0.566 |
| **5 s** | **0.053** — "check you're on the right piece and re-record" |

Not even monotonic through the audio path: 0.45 s passed, 0.50 s failed,
0.75 s passed, 1.5 s failed. Five seconds is tapping record, putting the phone
down and picking up the bow. All of them are 1.000 once both sequences share a
clock. `compute_deltas` already knew this — "the recording's lead-in latency is
not a timing error" — but it runs last, and the two stages before it did not.

Fixed in `alignment.to_timeline_base`, applied in both `analyze()` and
`analyze_with_diagnostics`. **This is a correctness fix, not a threshold
change; `config.toml` is untouched.**

### 2. To measure — the peak-picking window caps the playable tempo

`pre_max`/`post_max` are **20 frames each**. At hop 512 and 22.05 kHz a frame
is 23.2 ms, so the window is **±464 ms**. A peak has to be the maximum across
it, so notes closer together than that suppress one another.

Measured, 12 evenly spaced clicks:

| BPM (quarters) | gap | detected of 12 |
|---|---|---|
| 40–120 | 1500–500 ms | **12** |
| 132 | 455 ms | 7 |
| 160 | 375 ms | 2 |

A clean cliff exactly at the window. That is a ceiling of about **128 BPM in
quarter notes — roughly 64 BPM in eighths**. Kreutzer No. 2, in the app's own
demo library, is continuous sixteenths and sits far above it.

Untouched deliberately: it is a threshold, it needs the six real clips and the
regression rule, and `06_pizzicato` is the clip that will argue *against*
narrowing the window, since `wait_ms` and this window are what stop string ring
reading as extra onsets. **Check this first when the recordings exist.** It
also caught a test sitting on the cliff — `test_analyze_rushing_recording…` ran
at 132 BPM, so the detector saw 5 of 8 clicks and it passed at quality 0.430
against a 0.400 threshold. Moved to 110 against 100, where all eight are seen
and the test measures the verdict rather than the peak-picker.

### 3. To watch for — a spurious onset at the very start of a noisy recording

On the 48 kHz file, the detector fired an onset at **0.070 s** — about three
frames in, with the first real note at 0.500 s. It appears on the raw signal,
before the high-pass or pre-emphasis, so it is `librosa`'s peak-picker: at the
start of the signal the pre-window is truncated, so an early frame is trivially
a local maximum.

**It does not appear on the synthetic clips** and would never have been found
with them, because it needs a noise floor and they begin in digital silence. A
real room has a noise floor.

It matters because the first onset is now the alignment origin. On that file
the spurious mark was matched to the first written note, the *real* first note
was discarded as an extra, and a perfectly timed take reported "dragged by
25 BPM" — a confident wrong verdict where before there was an honest failure.

**Not fixed, deliberately.** Every candidate fix is a heuristic, and the only
evidence available today is one file fabricated this afternoon; DTW quality
cannot even tell the right origin from the wrong one (0.806 either way). This
is the first thing to look at on clip 01: the dashboard draws detected marks
against the waveform, so a stray mark before the first note is visible at a
glance. Leave about a second of room tone at the head of each take so it is
easy to see.

---

## 2026-08-16 — Tuning dashboard built. No thresholds changed.

**Not a tuning result.** The appendix's step 2 — build the readout before
touching a threshold — is now done, so the next entry in this file can be a
real one.

`backend/tuning_dashboard/` serves two pages: one clip in detail (waveform,
detected vs expected onsets, per-note deviation bars coloured by band, counts,
and the numbers pre-formatted for a tuning prompt) and all six at once, which
is what makes the regression rule cheap. Any tunable can be overridden per
request — `?onset.delta=0.05` — so three candidates can be compared without
editing `config.toml`. Nothing is written back; a value that wins gets moved by
hand, with an entry here.

`backend/app/services/diagnostics.py` exposes the pipeline's intermediate state
by calling the same functions `analyze()` calls with the same config object.
`test_diagnostics.py` asserts the two agree on status, verdict, quality and
every per-note delta — if they ever drift, the dashboard is measuring a model
of the pipeline rather than the pipeline.

**`config.toml` is untouched.** Every value is still the spec's §4 starting
number from the baseline entry below.

### The corpus is still missing, and that is what blocks the DoD

None of the six clips exist. `fixtures/audio/make_synthetic.py` generates click
tracks as stand-ins so the dashboard runs, and the UI labels every one of them
`synthetic`. They have exact known onset times — enough to show the dashboard
and the pipeline agree — and none of what a threshold actually has to survive:
bow noise, room reflection, a bass's slow attack, string ring.

### What the stand-ins show at the current (untuned) values

Useful only as a sanity check that the instrument reads:

| clip | detected / expected | missed | extra | worst | quality |
|---|---|---|---|---|---|
| 01 détaché clean | 32 / 32 | 0 | 0 | 20 ms | 0.988 |
| 02 détaché rushing | 32 / 32 | 0 | 0 | 257 ms | 0.872 |
| 03 détaché dragging | 32 / 32 | 0 | 0 | 231 ms | 0.872 |
| 04 slurred | 8 / 32 | — | — | — | 0.247 → `alignment_failed` |
| 05 open E 2s | 1 / 1 | 0 | 0 | 0 ms | 1.000 |
| 06 pizzicato | 16 / 16 | 0 | 0 | 20 ms | 0.988 |

Two observations that are about the synthesis, not the pipeline, and should not
be mistaken for findings:

- **The slurred clip failing alignment is by construction.** The generator
  gives slur-interior notes no attack at all, which is the honest worst case;
  8 detected against 32 expected is DTW correctly reporting it cannot align.
  The appendix expects this clip to fail in v1 on real audio too, but for a
  softer reason.
- **The 20 ms floor on the clean and pizzicato clips is frame quantisation**,
  not playing or detection error. librosa's default hop of 512 at 22.05 kHz is
  23.2 ms per frame, so no onset can be located more precisely than that. It is
  the resolution limit of the instrument and it bounds how tight the clean clip
  can ever look — worth knowing before reading ±15 ms as a target.

### A generator bug worth recording, because it looked like a pipeline finding

The first version of the synthetic notes cut the decay envelope off at a
non-zero value. A step discontinuity is a transient, so the detector fired on
every note's *end* as well as its start: 64 detections against 32 expected on
the dragging clip, 2 against 1 on the open E, and a phantom at the end of every
clip. It read exactly like a real over-detection problem that `wait_ms` should
have suppressed.

It was the fixture. The notes now fade to silence over their last 40 ms with a
raised cosine. The lesson generalises to the real recordings: a clip that stops
abruptly — a hard edit, a fade cut short — will produce phantom onsets that
look like a threshold problem and aren't.

## 2026-07-24 — Baseline: config.toml shipped with spec §4 STARTING values (untuned)

This is the starting point, not a tuning result. `backend/config.toml`
was created with the spec's default numbers, none of them yet validated
against real recordings:

- `onset.delta = 0.07`, `pre_max = 20`, `post_max = 20`, `wait_ms = 60`
- `onset.double_bass.delta = 0.05`, `highpass_hz = 80.0`
- tolerance bands symmetric: inner 5% / mid 10% / outer 20% (rushing == dragging)
- `alignment.warn_quality = 0.7`, `broken_quality = 0.4`, `sakoe_chiba_band = 0.2`
- `trend.window = 8`

**Not yet done (blocks closing the Batch 3 DoD):**
1. Record the six-clip corpus (01_detache_clean … 06_pizzicato) per the
   Tuning Appendix.
2. Set the tolerance bands empirically by ear (Appendix step 6). Expect
   the rushing/dragging bands to end up asymmetric — the config already
   has separate keys for each so tuning is a value change, no code edit.
3. Tune `delta` / `wait` against the slurred and pizzicato clips.

Every one of those changes gets its own entry below, with clip-by-clip
regression results. Until then, verdicts are directionally correct
(the pipeline is unit-tested) but the exact thresholds are provisional.
