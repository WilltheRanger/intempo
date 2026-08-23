# InTempo Audio Tuning Log

Populated during Batch 3. Format spec: see "Batch 3 Tuning Appendix"
in intempo-combined.md. Every threshold change logs old value, new
value, regression results across all six fixture clips, and rationale.

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
