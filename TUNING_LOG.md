# InTempo Audio Tuning Log

Populated during Batch 3. Format spec: see "Batch 3 Tuning Appendix"
in intempo-combined.md. Every threshold change logs old value, new
value, regression results across all six fixture clips, and rationale.

---

## 2026-09-19 — Two new thresholds, after a third approach was built and reverted

**New section `[onset.recovery]`: `search_share = 0.25`, `floor_ratio = 0.015`.**
No existing value changed. The six clips are **byte-identical** — by
construction, not by luck, and that is the whole argument for this shape.

### The defect

Measured with new degradation models (`add_noise_at_snr`, `add_room_reverb`,
`apply_clipping` in `audio_helpers`). Noise, clipping and reverb *alone* do not
break detection — 0 dB SNR, hard clipping and a 2-second room all keep 24/24
notes. **Dynamic range against a reverberant room does:**

    20 dB range, dry          24/24      30 dB range, dry          24/24
    20 dB range, RT60 0.9s    16/24      30 dB range, RT60 0.9s    12/24

Precision stays 1.00 — the quiet notes are gone, not mistimed. End to end at
92 BPM the 20 dB case is **refused outright**: coverage 0.667, quality 0.248,
and a musician who played the page correctly is told to check the piece.

### The approach that was reverted

Replace the absolute `delta` on a globally-normalised envelope with a local
one: `envelope / max(local_mean, floor × peak)`. The diagnosis behind it is
correct and still stands — a quiet note's peak collapses from 0.22 to 0.030
while `delta` stays 0.07, so it is rejected by about the width of `delta`.

It fixed the target case (20 dB + reverb 0.67 → 1.00) and **passed all six
corpus clips at every setting tried**. Against the full audio suite it failed
at every window:

    adaptive_avg_s   0.10    0.20    0.35    0.50
    failures           14      13      14      13        (baseline: 0)

Chief casualty: every assertion in `test_varied_rhythm.py`. A local baseline
computed as a **mean** is raised by dense passages and lowered by sparse ones,
so on mixed note values the threshold moves with the rhythm it is meant to be
a reference for. No window escapes that; it is structural. Reverted before it
left the working tree, as the 2026-09-14 change was.

**A methodological note, because it nearly shipped.** The window was swept
against a *subset* of the suite, where 0.50 looked like it fixed everything —
the bowed re-trigger, the noise case, and the dynamics win together. Against
the full suite that same value is 13 failures. A sweep against a subset is
fiction.

### What shipped instead

A second pass, after alignment, that looks **only where the score writes a
note and the alignment found none**, and can only add an onset there. Two
properties follow and both were the reason for the shape:

  * A take that missed nothing is **byte-identical** — `missed_expected` is
    empty and the pass returns before touching the audio. The six clips are
    therefore unchanged without needing to be re-tuned.
  * A phantom cannot appear where the page writes no note.

`floor_ratio = 0.015` is far below anything the detector reports, and the
first value tried — 0.08 — was wrong for exactly that reason: the population
it exists to find peaks at 0.030, so 0.08 rejected all of it and recovered
nothing. **The window is the guard, not the floor**: a quarter of the closest
written gap, around a time the page and the take's own fitted pace agree on,
with an interior local maximum required.

Placement mattered as much as the numbers. It was first written *below* the
refusal check, where it was useless — a take refused on coverage returns early
and never reaches the code written to rescue it.

### Regression

| | without | with |
|---|---|---|
| Six corpus clips | pass | pass, **byte-identical** |
| 92 BPM, 20 dB + RT60 0.9s | `alignment_failed`, q 0.248 | **`ok`, q 0.603** |
| Clean take, same page | `ok`, q 0.970 | `ok`, q 0.970, same onsets |
| Full backend suite | 2,321 passed | **2,332 passed, 0 failed** |

Still open: 30 dB + reverb at 92 BPM, and everything at 120 BPM, remain
refused. The pass helps and does not yet close the case.

---

## 2026-09-14 — Bowed attacks measured, and a threshold change written and thrown away

**No value changed**, and the first draft of this entry changed one. Recorded
in full because the wrong answer was *convincing*, and the thing that caught it
is the reason this file's own README says a synthesised clip cannot settle a
threshold.

### The wrong answer

A bowed attack was modelled as a squared ramp on a **pure sine**, and against
that model raising `[onset] delta` from 0.07 to 0.12 looked excellent — every
struck take bit-identical, and a 120 ms attack going 0.000 → 0.789. It survived
a dynamics sweep (0.20 went deaf, 76 detections for 95 notes; 0.12 did not) and
the six corpus clips were byte-identical at both values, because they are click
tracks and `delta` does not reach them.

The repository already had a far better model — `audio_helpers.synth_bowed_note`,
a Helmholtz sawtooth under a raised-cosine rise, in a room with one mode and a
mic floor, written precisely to test low-register detection. Re-run against it,
the answer **inverts**:

| take (repo bowed model) | delta 0.07 | delta 0.12 | delta 0.20 |
|---|---|---|---|
| violin, 35 ms rise | **0.984 / 95** | 0.919 / 93 | 0.286 / 78 |
| violin, 80 ms rise | **0.984 / 95** | 0.393 / 81 | 0.380 / 78 |
| violin, 120 ms rise | **0.872 / 97** | 0.233 / 80 | 0.370 / 78 |

A pure sine carries one partial and almost no flux at onset; a bowed string
carries a full harmonic series and plenty. The detector was never the problem
for bowed **violin** — 0.07 reads it correctly — and the "fix" would have cost
15 of 95 notes on a real one. Reverted before it left the working tree.

### What is actually true, on the good model

`double_bass`, five attack times, `double_bass_delta` on the left as it ships:

| rise | δ 0.05 (ships) | δ 0.08 | δ 0.12 | δ 0.18 |
|---|---|---|---|---|
| 35 ms *(the model's own default)* | **0.976 / 95** | 0.932 / 94 | 0.524 / 73 | 0.524 / 73 |
| 60 ms | 0.806 / 97 | **0.926 / 94** | 0.000 / 78 | 0.603 / 73 |
| 90 ms | 0.641 / 101 | **0.895 / 94** | 0.538 / 76 | 0.755 / 73 |
| 120 ms | **0.000 / 104** | 0.658 / 91 | 0.603 / 73 | 0.603 / 73 |
| 160 ms | 0.230 / 104 | 0.578 / 93 | 0.602 / 73 | 0.602 / 73 |

δ 0.08 wins four rows of five and turns a refusal into a reading at 120 ms.
**It was still not taken.** The one row it loses is the rise the model's author
chose as typical, and `[onset.double_bass]` already documents the opposite
reasoning — "slow attack envelopes, broad onset peaks… *lower* delta" — for
catching soft attacks. Moving a threshold against a documented decision, on
evidence from a synthesiser, in the direction that makes a detector deafer, is
the move this project has twice written down as wrong. It wants one real bass
recording, which is what `fixtures/audio/README.md` has been asking for since
Batch 3.

### The mechanism, which is not what "over-detection" suggests

Measured on a 95-note page at a 120 ms bass rise:

- **No note is double-triggered.** The closest two detections sit **279 ms**
  apart against a closest written gap of 375 ms. `pre_max`/`post_max`, derived
  per take from that gap, already exclude a re-trigger. The extra 9 detections
  over 95 notes come from elsewhere in the take, not from notes firing twice.
- **Every onset lands late, and the lateness moves**: +61 ms after a long note,
  +123 ms inside a run of eighths. A *constant* lag is free — `_residuals` fits
  offset and rate before quality is measured — so it is the variation that
  survives and costs the take.

`test_bowed_attacks.py` pins all three findings.

### One knob found inert

`[onset] wait_ms` is passed to librosa as `wait` and changes nothing: swept
60 → 100 → 150 → 200 ms across five attack times, every reading
byte-identical. Peak-picking already requires each onset to be the maximum over
±`peak_window_frames` (16 frames, 372 ms, on a page of eighths at 80 BPM)
against this value's 3. Documented in `config.toml` beside `post_max`, which
was found the same way.

### What this entry cannot claim

Every number above comes from a synthesiser. The six corpus clips are click
tracks and were byte-identical before and after everything tried here, so they
vetoed nothing and validated nothing. **The pipeline has still never been run
against a real instrument.**

## 2026-09-14 — Every take the app had ever analysed was refused, and no threshold was wrong

**No value changed.** Nothing in `config.toml` moved. What changed is what
`align_dtw` compares a take against, and the reason is that the thresholds were
never the problem — they had simply never been asked a question they could
answer.

**The readings.** All eight rows in `analyses` on the live project, 2026-09-12 to
2026-09-14, finished `done` with `result_json.status = alignment_failed` and
`quality` **exactly 0.000**:

| analysis | detected | expected | coverage ceiling | quality |
|---|---|---|---|---|
| `a967f5ee` | 6 | 74 | 0.081 | 0.000 |
| `d578857b` | 11 | 74 | 0.149 | 0.000 |
| `3bc2e100` | 23 | 76 | 0.307 | 0.000 |
| `2aac1ba8` | 29 | 76 | 0.387 | 0.000 |
| `b83e75e4` | 29 | 76 | 0.387 | 0.000 |
| `44975f56` | 34 | 76 | 0.453 | 0.000 |
| `5d6011ba` | 39 | 76 | 0.520 | 0.000 |
| `8c4e2c8a` | 52 | 75 | 0.693 | 0.000 |

`quality` is `timing_quality * coverage` and `coverage <= n_detected /
n_expected`, so the fourth column is a ceiling that applies before a note is
compared. **Five of the eight sat under `broken_quality` (0.4) on the onset
counts alone** — no performance of those recordings could have passed, and
lowering the cutoff to admit them would have had to reach below 0.08.

**Why no threshold could have been read off these.** The takes ran 2 to 56
seconds against pages spanning 74 to 82. `librosa.sequence.dtw` was called with
`subseq` at its default `False`, which anchors the path corner to corner, so each
take was stretched across the whole page. A tuning pass against these readings
would have been measuring the stretch.

**Measured, on a reconstruction of the real 25-bar part** (`Elijiah`, the score
pulled from the live DB, rendered as a click track at its own `target_bpm` of 80,
so the grid matches what was played):

| take | before | after |
|---|---|---|
| the whole page, perfectly in time | 0.984 `ok` | 0.984 `ok` |
| the whole page, ±40 ms human jitter | 0.914 `ok` | 0.914 `ok` |
| the page's first 75% | 0.725 `ok` | 0.725 `ok` |
| the page's first 50% | **0.000 `alignment_failed`** | **0.487 `ok`** |
| the page's first 25% | **0.000 `alignment_failed`** | **0.984 `ok`** |
| the middle 40% | **0.000 `alignment_failed`** | **0.985 `ok`** |

**What is still refused, and is a separate fault.** Over-detection — more attacks
heard than the page writes — is untouched, because a subsequence match is not
defined when the query is the longer sequence. Rendered with a 120 ms bowed
attack the detector reports 114 onsets for 95 notes and the take still scores
0.000; at 60 ms, 0.239. That is the next thing to measure and it wants real
audio, not a synthesised attack envelope.

**On the regression this entry does not claim.** CLAUDE.md asks for a clip-by-clip
run across all six fixtures. `fixtures/audio/README.md` says in its first
paragraph that **none of the six were ever recorded**; `make_synthetic.py` stands
in for them and its own header says a synthesised click "cannot tell you whether
a threshold is right". The six are exercised by `test_corpus_regression.py` and
pass, and that is worth exactly what it is worth. The readings above are from
click tracks too. **The pipeline has still never been run against a real
instrument in a test**, which is the condition this failure was hiding in.

The four real takes are also unavailable for one: `keep_playback_copy`
re-encodes to Opus and deletes the WAV after a successful run, and
`storage.objects` now holds only `.opus` for all eight.

## 2026-09-08 — The tuning dashboard was detecting twice the onsets the pipeline does

**No value changed.** `analyze()` is untouched; every threshold in
`config.toml` is what it was. What changed is that the dashboard now reports
the pipeline's numbers on a page with an ornament on it, which it did not.

`diagnostics.py` had copied `analyze()`'s preamble — decode, high-pass, read
the score, detect — and the copy called
`closest_expected_gap(expected)` where the original calls
`closest_expected_gap(expected, optional=grace_onsets)`. One keyword.

With no grace notes on the page the two arguments are the same value, which is
why nothing caught it: `test_diagnostics_matches_analyze` uses eight plain
quarters and agrees either way.

Measured, one acciaccatura on a bar of eight quarters played exactly on the
grid:

| | detector `min_gap_s` | onsets detected |
|---|---|---|
| `analyze()` | 1.00 s | **8** for 8 clicks |
| dashboard, as it was | 0.15 s | **16** for 8 clicks |

That is the failure `closest_expected_gap`'s own docstring records — the window
shrinking everywhere to chase an acciaccatura, "14 onsets detected for 8
clicks" — happening to the tool that exists to tune it away.

**What this means for readings already taken.** Nothing in `TUNING_LOG.md`
records a value chosen off an ornamented clip, and no threshold has been moved
yet, so there is nothing here to revise. But any onset count, envelope or
matched-pair reading taken from the dashboard on a clip whose score carries a
grace note was not what the pipeline would have produced, and should be taken
again.

**Fix.** The preamble is now one function, `analysis.prepare_for_alignment`,
which both call — two implementations of one order of operations cannot be kept
in step by reading them. `test_diagnostics.py` gains the ornamented case; it
fails against the old call and passes against the shared one.

## 2026-09-04 — The blast radius of changing a band, before anyone changes one

**No value changed.** Read this before the first real tuning pass.

### `config.toml` is not the whole surface

`audio_config.py` claimed every threshold the pipeline uses lives in the file.
It does not. Eleven decision constants live in Python: `ORNAMENT_SHARE`,
`MIN_TEMPO_RATIO` / `MAX_TEMPO_RATIO`, `MIN_ONSETS_TO_ESTIMATE_TEMPO`,
`MAX_EDGE_TRIM`, `MIN_TRIM_GAIN`, `POSITION_WEIGHT`, `POSITION_CAP_GAPS`,
`_GAP_CORE_LOW` / `_GAP_CORE_HIGH`, `TAKE_TOO_LONG_RATIO`.

Most are structure rather than knobs and their own comments say so with
measurements — `POSITION_WEIGHT` behaves identically anywhere from 0.25 to 2.0;
`MIN_TRIM_GAIN` repairs failures running 0.029 → 0.988. Leave them.

**`ORNAMENT_SHARE` is the one for this session.** Its comment: *"Chosen against
two synthetic takes and no real recording, which is the honest limit on it."*
It decides where a grace note and the note it decorates are placed, and those
notes are reported to a musician as "not timed" precisely because the number
was invented. It is not in `config.toml`, so nothing in the file will remind
anyone it exists.

### Changing a band changes the app, in a way that is easy to get backwards

`FALLBACK_INNER_PCT = 5` and `FALLBACK_OUTER_PCT = 20` in
`mobile/src/lib/tempo.ts` are the bands the app assumes for a take that carries
no tolerance of its own — rows finished before the pipeline started storing the
numbers it judged by.

They currently equal the shipped config, and their docstrings said they
*matched* it. **They must not follow it.** A take analysed on today's bands was
judged by 5 and 20; re-banding it by whatever the bands become re-judges a
performance nobody re-recorded, and a musician's history changes under them for
no reason they can see. Leave the constants alone unless the old bands were
*wrong* rather than merely untuned.

`backend/app/tests/test_fallback_bands.py` fires the moment the two diverge and
states both answers. Two neighbours in it are worth knowing before you widen
one side:

  * the fallback is **one** number standing in for a rushing/dragging pair, so
    it is honest only while the two sides are equal — and the tuning appendix
    says to widen dragging;
  * `bandFor` infers the mid band as **half the outer**, which is where the
    spec's starting values put it and is not a law.

Both are app-side consequences of a one-line config edit, and neither is
visible from `config.toml`.

Measured: widening the dragging bands to 7/26 fires three of those cases,
passes all 1504 mobile tests, and fails exactly one existing backend test —
`test_classify_band_dragging_side`, about the pipeline. Update that one and the
app is still wrong.

---

## 2026-09-04 — Two of the twenty-two knobs turn nothing, and the file gave no sign

**No value changed.** This is about the instrument the tuning session will use.

The whole argument for `config.toml` is CLAUDE.md §1 rule 7 and
`audio_config.py`'s own first line: *"change a number, re-run the fixtures, log
it here; no code edit."* Batch 3's thresholds are still the spec's starting
values because tuning needs real ears on real recordings, so that session has
yet to happen — and when it does, it happens by editing this file.

**A knob that turns nothing is the worst way that loop can fail.** The tuner
changes a number, the corpus reads identically, and the honest conclusion from
that evidence is *"this parameter does not matter."* It would be logged here as
a measurement, and it would be a measurement of nothing.

Measured: of the 22 fields `AudioConfig` declares, **20 are read by the
pipeline and 2 are not**.

| knob | why it is inert |
|---|---|
| `onset.post_max` | The peak-pick window is no longer *chosen*. `peak_window_frames` derives it per take from the smallest note gap the score and `target_bpm` imply, and passes the one number to librosa as **both** `pre_max` and `post_max`. `pre_max` survives as the cap on that; `post_max` is read by nothing. |
| `alignment.slur_tolerance_pct` | The threshold for the whole-slur duration check in spec §4, which was never built. `alignment.py` says so itself on `is_slur_boundary`. What exists is `is_slur_interior`, which *excludes* those notes from the trend and the verdict rather than measuring a phrase against a tolerance. |

`post_max` is the one that would have cost time. It sits directly beneath
`pre_max`, reads as its pair, and `peak_window_frames`'s docstring is a long
argument about exactly this window — the measured table of *"window 3:
sixteenths 32/32 found; window 20: 4/32"* is the most consequential detector
finding in this repository. Anyone re-opening it would reach for both numbers.

**Neither is deleted and neither is wired up.** Removing a key is a decision
about the remote-config row a deployment may already be sending; wiring
`post_max` means deciding whether an asymmetric window is right, which is a
question for this session with the corpus and an ear, not for a commit that
cannot hear anything. What was wrong was that the file gave no sign: both sat
beside live values with a spec citation each. They now say so where the tuner
is looking, and `backend/app/tests/test_tuning_knobs.py` holds it — a *new*
dead knob fails, and so does a stale entry for one that has since been wired.

---

## 2026-09-04 — Baseline: what the pipeline says about all six corpus clips today

**Nothing in `config.toml` changed.** This is the corpus read out, so the
tuning session that is still waiting on real recordings has a stated starting
point rather than a memory of one.

Each clip analysed through `analyze()` with its own `manifest.json` entry — the
score it was played from, its `target_bpm`, its `double_bass` flag — on the
shipped config:

    clip                  direction  quality  verdict
    01_detache_clean      on         0.988    Steady tempo — you held it within
                                              tolerance across the piece.
    02_detache_rushing    rush       0.988    You rushed across measures 2–8 by
                                              an average of 9 BPM.
    03_detache_dragging   drag       0.988    You dragged across measures 3–8 by
                                              an average of 9 BPM.
    04_slurred            on         0.990    Steady …
    05_open_e_long        on         1.000    Steady …
    06_pizzicato          on         0.990    Steady …

**Every one matches what the manifest's `expect` field says in words**, which
had never been checked either way. `04_slurred` at 0.990 is the one worth
noting: `build_timeline`'s comment records it scoring **0.196** and reporting
`alignment_failed` while an onset was expected under every bow stroke, so
slurred playing could not be analysed at all.

### A test over this, written and reverted

I wrote `test_tuning_corpus.py` to hold the table above, on the argument that
the corpus is the artefact the whole tuning story rests on and nothing ran it —
`test_cli.py` prints one line from one clip, `test_audio.py` borrows another as
a block of audio to filter, and `test_analysis.py` synthesises its own clicks
in-test.

Then I mutated the pipeline to find out what it was holding. Five mutations,
each run against the new file alone and against the suite without it:

| mutation | existing suite | corpus file |
|---|---|---|
| inner bands 5% → 40% (nothing is ever rushing) | 10 failures | 2 |
| an onset expected under a bow stroke again — the slur bug | **7 failures** | 2 |
| `wait_ms` 60 → 5 | 0 | 0 |
| `delta` 0.07 → 0.005 | 1 | **0 — passes** |
| `pre_emphasis_coef` 0.97 → 0.0 | 1 | **0 — passes** |

Not one unique catch, and the last three are the reverse of what I predicted: I
expected real timbre — a decaying bow stroke, pizzicato ring, a two-second open
E — to be *more* sensitive to detector settings than a synthesised click track,
and it is less.

Its docstring also claimed the slur fix was held by nothing. Seven tests hold
it, including `test_alignment.py::test_a_slurred_passage_played_as_written_
aligns_perfectly`. That claim was written from CLAUDE.md's account of the bug
rather than from measurement, and measurement contradicted it.

So the file was reverted, and the `direction` field it added to
`manifest.json` with it — an unread field is the same debt one level over.
Same call as two other tests dropped today, for the same reason: a test that
adds no discrimination makes the next person believe the corpus is guarded when
the guarding lives somewhere else.

**What would change that.** When real recordings replace the synthetic clips,
nothing else in the suite will touch those files, and a test saying "the corpus
still reads as its manifest describes" earns its place then. Writing it now, to
be useful later, is how unread code gets made.

---

## 2026-09-04 — Measured: how far the steady band can be narrowed before a perfect take is accused

**Nothing in `config.toml` changed.** This records a measurement that the
pending Batch 3 tuning needs, and corrects a piece of reasoning I had wrong.

### The clip

`fixtures/audio/app_encoder_click_track_48k.wav` — 8 bursts 0.5 s apart, which
is 8 quarter notes at exactly 120 BPM, written by the app's own
`encodeWavBytes`. Judged against a two-bar 4/4 score at a target of 120. The
take is **perfectly in time by construction**, so anything but "steady" is the
pipeline accusing a musician who did nothing wrong.

### `tolerance.rushing_inner_pct` and `dragging_inner_pct`, walked down together

    5.0 (shipped)  Steady tempo — you held it within tolerance across the piece.
    4.0            Steady
    3.0            Steady
    2.0            Steady
    1.5            Steady
    1.0            Steady
    0.5            "You rushed across measures 1-2 by an average of 2 BPM."

**Roughly five times the headroom under the shipped value.** `quality` is
0.975 at every one of them — the inner band moves the sentence, not the score.

### The reasoning I had wrong

I expected the floor near **6%**. The detector reports these attacks +10 to
+31 ms late (`test_app_encoder_wav.py` tabulates all eight), and 31 ms is 6.2%
of a beat at 120 BPM, so it looked as though narrowing past that would accuse
everyone.

It does not, because a *constant* lateness never reaches the bands:
`to_timeline_base` re-zeros the detected onsets on the first of them, and
`pulse_anchors` re-anchors after a disturbed run. Only the **spread** survives
— about 10 ms here — and that is what sets the floor between 0.5% and 1.0%.

Worth writing down because it points the other way from the obvious reading of
the detection times: the detector's absolute bias is not a constraint on
tuning, and its jitter is much smaller than that bias.

### Two things this does not say

It is one synthetic clip of eight identical bursts — the cleanest possible
input, and no substitute for the real recordings the tuning is actually
waiting on. And the outer bands were not walked; only the inner one, which is
the boundary between "steady" and being told something.

---

## 2026-09-02 — Measured: the onset detector is amplitude-invariant. One new threshold, and it is zero.

**Nothing in `config.toml` changed.** No clip moved, because nothing the
pipeline does was altered — this entry records a *measurement* that decided a
new threshold in the app, and corrected a sentence the pipeline was telling
musicians.

### The measurement

Every fixture, scaled to a series of peak levels and **requantised to 16 bit at
each one** — a float scaled to -90 dBFS is not the same object as one that
survived a WAV file, and the app uploads WAV. Onset counts from
`detect_onsets` under the shipped config:

    fixture                              0dB  -20  -40  -50  -55  -60  -65  -70  -80  -90
    01_detache_clean.synthetic            32   32   32   32   32   32   32   32   32   32
    02_detache_rushing.synthetic          32   32   32   32   32   32   32   32   32   32
    03_detache_dragging.synthetic         32   32   32   32   32   32   32   32   32   32
    04_slurred.synthetic                   8    8    8    8    8    8    8    8    8    8
    05_open_e_long.synthetic               1    1    1    2    1    1    1    1    1    1
    06_pizzicato.synthetic                16   16   16   16   16   16   16   16   16   16

At -90 dBFS the samples are barely more than one LSB and the reading is
unchanged. The single cell that moves — `05_open_e_long` reading 2 at -50 dBFS
— is a one-note clip whose reading was never stable enough to build on.

Then the shapes that are not music, ten seconds each:

    digital silence          0 onsets
    silence + 1 LSB dither  11 onsets
    white noise -60 dBFS    10 onsets
    white noise -20 dBFS    10 onsets
    DC offset only           0 onsets

**Level is not what separates a take with notes in it from one without.**
`onset_strength` differences a dB-scaled mel spectrogram, so scaling a waveform
shifts every frame by the same constant and the differencing removes it. The
detector is amplitude-invariant by construction, and the measurement is the
construction showing through.

### What it changed

1. **The `no_onsets` message said "try re-recording a bit louder."** That is
   advice that cannot work: the only recording that reaches `no_onsets` is a
   digitally silent one, and playing louder into a muted microphone produces
   the identical file. It now names the input. The same branch also fires when
   the *score* has no notes, where it was blaming a musician for a page the app
   failed to read — that case is now named first and separately.
2. **A new threshold in the app, `capturedNothing`, and it is exactly zero.**
   `mobile/src/lib/audio/level.ts` refuses a take whose every sample is zero,
   before the upload and before it costs one of three free monthly analyses.
   The measurement is what sets the value: since a take at the bottom of 16-bit
   resolution analyses exactly as well as a loud one, **any** non-zero floor
   would take a verdict away from a musician who could have had one. This is
   the rare threshold that is not a judgement call.

### What this does not claim

The fixtures are synthetic and normalised to 0.9 peak by `make_synthetic.py`,
so they say nothing about the level a real phone records a real violin at. They
do not need to: the finding is that level does not matter, which is a property
of the detector rather than of the corpus.

---

## 2026-09-02 — Two new thresholds in `[tolerance.pulse]`. Nothing existing moved.

**No existing value in `config.toml` changed, and all six clips are
bit-identical** — status, quality, note count, missed, extra, summed delta and
full verdict text. `02_detache_rushing` still reads "rushed across measures 2–8
by an average of 9 BPM".

### What the new values are for

The verdict measured every note from the first note of the take, so a musician
who held one bar was told every later bar dragged. The user chose the other
reading — *"one bar dragged, measure against your own pulse"* — which needs the
reference to re-anchor across a break in the pulse and **not** across a steady
drift. Those are a step and a ramp, and telling them apart is a threshold.

    disturbance_deviations  = 6.0     robust deviations of the take's own
                                      interval errors
    disturbance_floor_beats = 0.1667  a floor under that, as a fraction of a beat

### Why these numbers are not delicate

The two things being separated are twenty-five times apart:

    a steady rush (02_detache_rushing)        8 ms per beat, note after note
    a bar held a quarter longer than written  208 ms, on one interval

Six deviations sits in the middle of a very wide gap. The floor exists for a
different reason — a take played to machine precision has a median deviation
near zero, so a pure multiple would make the threshold zero and read *every*
interval as a disturbance. A sixth of a beat is "a musician who broke their
pulse by less than this did not break it".

### Behaviour, measured on offset series directly

    steady rush 8 / 30 ms per beat       accumulates untouched, every note
    steady drag 50 / 120 ms per beat     accumulates untouched
    played exactly                       zero throughout
    one 300 ms pause                     +300 ms on that note, zero after
    four notes held +200 ms (a slow bar) +200/+400/+600/+800, zero after
    rush → pause → rush                  the pause on its own note, and the
                                         rushing on both sides preserved
    steadily accelerating                accumulates quadratically, untouched

The fourth row is why the reference re-anchors after a **run** rather than a
single interval: a bar played slow is four stretched intervals, and absorbing
them one at a time would call the bar clean, which is the opposite mistake.

### Still unmeasured

Everything above is synthetic. What a real hesitation looks like on a real bass
— whether it is one long interval or a smear across three — is the thing that
decides whether six deviations is right, and only the six recordings can say.
Both values are starting points.

---

## 2026-08-31 — First measurements on a bass-like signal. No threshold changed.

**`config.toml` is untouched.** All six clips are bit-identical; nothing here
moved a number. This is evidence, filed against the open questions below.

### What had never been tested

`double_bass=True` switches on two things: a 4th-order high-pass at 80 Hz and
`delta` 0.07 → 0.05. It has had plumbing tests since it was wired up — does the
stored instrument reach `analyze()` — and no signal tests at all. Every audio
fixture in the repo is an 880 Hz decaying sine. That is five octaves above the
instrument the spec names in its first paragraph, with an attack no bow can
produce. The low-register path had never been shown a low register.

`app/tests/audio_helpers.py` now synthesises one: a Helmholtz sawtooth (bowed
strings are close to one, and the partials are what carries the attack once the
fundamental is filtered away), a 35 ms raised-cosine rise, a resonant room mode
at 58 Hz, and a −60 dBFS floor.

### Results

| clip | result |
|---|---|
| open E (41.2 Hz), 8 bowed notes at 60 BPM | 8/8 |
| open A (55 Hz) | 8/8 |
| open G (98 Hz), above the corner | 8/8 |
| scale, sixteenths at 72 BPM (208 ms apart) | 16/16 |
| scale, notes 100 ms apart (sixteenths at 150 BPM) | 15/16 |
| double-bass path vs default, same clip | never fewer |

**Detection lag ≈ +50 ms, and it is flat.** A bowed attack peaks in the flux
tens of milliseconds after the note starts, so every onset is reported late.
That is harmless if it is constant — `to_timeline_base` shifts the sequence to
a zero origin and a uniform offset cancels — and dangerous if it varies with
note density, because then it is reported as the musician speeding up at
exactly the bar where the writing changes.

Measured on a passage dead on the grid, quarters → sixteenths → quarters at
72 BPM:

    quarters    n=12   median lag  +46 ms   spread 21 ms   =  +5.5% of a beat
    sixteenths  n=16   median lag  +54 ms   spread 10 ms   =  +6.5% of a beat
    differential                    +9 ms                  =  +1.0% of a beat

1.0% of a beat, against an inner tolerance band of 5%. The lag is a constant,
and constants cancel. Pinned by a test at 3%.

### What this cannot settle, measured rather than assumed

**The high-pass corner is not constrained by any of it.** Moving it from 80 Hz
to 400 Hz leaves every test passing. That is a property of the signal: an
idealised sawtooth carries its attack across the whole spectrum, so throwing
half of it away costs nothing. A real bass's high partials are weaker and
noisier, which is precisely the difference that would make a wrong corner
audible.

**Nor can it show the filter helping.** The stated justification is rejecting
room-mode ring that fakes an onset (§7.5 problem 1/3). Swept the mode gain
0.55 → 3.0 with no filter, 80 Hz, and 400 Hz: **zero spurious onsets in all
nine combinations.** A linear resonance ringing down smoothly produces no flux
rise, so it never looks like an attack. A real room's early reflections are
discrete arrivals and would; this model has none.

So the high-pass remains unjustified by measurement in either direction. It is
also still the open question below — the spec contradicts itself about whether
the low register wants a *boost* (§1281) or a *high-pass* (§2490), and these
tests cannot break the tie.

### Standing open questions

1. **Boost or high-pass for double bass?** §1281 says boost 80–300 Hz; §2490
   says high-pass. The code high-passes. Needs the six clips and a human ear.
2. **The corner frequency**, per above. 80 Hz is the spec's number and nothing
   has tested it.
3. **`delta` 0.05 for the low register.** The only parameter these tests do
   constrain: raising it to 0.6 fails them. That is a floor, not a value.

All three need `01_detache_clean.wav` and the five after it. Recording them is
still the blocker, and no amount of synthesis substitutes for it.

---

## 2026-08-30 (last) — The peak-picking ceiling, resolved without a threshold change

**`config.toml` is untouched.** `pre_max` stays 20 and is now a *cap* rather
than the value. All six clips are bit-identical — they are all at 60 BPM, where
the derived window resolves to the cap and nothing changes.

### The ceiling, as arithmetic

`pre_max`/`post_max` make a peak the largest in a window, so a window wider than
the gap between two notes means the quieter of them is never reported. At 20
frames — **±464 ms**:

| note value | detectable below |
|---|---|
| quarter | 129 BPM |
| eighth | 65 BPM |
| triplet eighth | 43 BPM |
| **sixteenth** | **32 BPM** |

Nobody practises sixteenths at 32 BPM. Most étude and excerpt writing was
invisible. `librosa`'s own default for this sample rate is **1** frame.

### The corpus could not decide it, and that is a finding

Swept 1 → 20 frames across all six clips: **121/121 onsets, 0 spurious, at every
value**. The clips are all quarters or eighths at 60 BPM — gaps of 500–1000 ms,
where a 464 ms window suppresses nothing and there is no ring to over-detect.
The corpus cannot see this parameter at all.

### Why no constant works

The window is wide because it stops one note being detected twice. Probed
against the failure shapes the spec names:

| signal | window 3 | window 20 |
|---|---|---|
| ringing pizzicato | 8 hits / **8 spurious** | 8 / 0 |
| one note, heavy vibrato | 1 / 26 | 1 / 4 |
| sixteenths @ 100 BPM | **32/32 found** | **4/32 found** |

The wide window is doing real work. And no constant can do both, for an exact
reason: a **5.5 Hz ring beat is 182 ms apart** and **sixteenths at 100 BPM are
150 ms apart**. They are the same time scale, and nothing in the timing
distinguishes them.

Separating the two knobs was tried and failed — raising `pre_avg`/`post_avg`
(never configured; librosa defaults them to 100 ms) improved sixteenths from 12
spurious to 2, and did **nothing** for ring or vibrato.

### What the score already knows

It says which note values are written; `target_bpm` says how fast. The smallest
gap to expect is known before a sample is read. The window is now half of it,
capped at `pre_max`:

| signal | derived | fixed 20 |
|---|---|---|
| ringing pizzicato | 8/0 (window 20) | 8/0 |
| heavy vibrato | 1/4 (window 20) | 1/4 |
| sixteenths @ 100 BPM | **32/1** (window 3) | 4/0 |

Slow music is untouched because the derivation returns the cap there. Fast music
becomes detectable at all.

**Still synthetic.** The ring and vibrato signals are the failure *shapes* the
spec names, not recordings of them. What is not synthetic is the ceiling: a
window wider than the gap cannot report both notes, and that is arithmetic.

---

## 2026-08-30 (later) — Matching bounded. No thresholds changed, corpus unmoved.

`config.toml` untouched. All six clips identical to the entry below —
0.988 / 0.988 / 0.988 / 0.990 / 1.000 / 0.990, same onset counts, same worst
deviations. Every one of them is a full take at its target tempo, which is
exactly the case this change leaves alone.

### What it fixes

Matching normalised each sequence onto its own unit span. That is *unbounded*:
it stretches whatever it is given until the two ends line up, so it **asserts**
that the take covers the score. A musician who played the first half of a piece
had those notes smeared across all of it — every delta measured against the
wrong written note, reported confidently. On a 40-note score, a take of notes
0–19 mapped to written notes 0–39.

A clamped ratio of median inter-onset intervals cannot do that. The bound is
what makes it safe rather than merely different: reading a half take as a whole
one needs **2×**, reading every-other-note as a complete slow take needs
**0.5×**, and neither is reachable at [0.6, 1.7].

| case | span (was) | bounded (now) |
|---|---|---|
| perfect | 1.000 | 1.000 |
| 5% fast | 1.000 | 1.000 |
| 20% fast | 1.000 | 1.000 |
| gradual rush 13% | 0.725 | 0.725 |
| first half | 0.400 | **0.500**, and maps to 0–19 not 0–39 |
| every other note | 0.301 | **0.119** |
| WRONG PIECE | 0.248 | **0.000** |

Better or equal everywhere. Wrong-piece rejection improves most.

### Why there is a minimum take length

A median over two intervals is not a median, and a *missed* note inflates one —
`[0.5, 1.0]` medians to 0.75 and compresses a take that was played evenly. That
showed up as a real regression on a four-note test before the minimum went in.

It is also unnecessary below that length, and for the same reason it is
unreliable. The sliding error scaling exists to prevent grows with the take, so
at 20% fast:

| notes | unscaled | scaled |
|---|---|---|
| 3–6 | **1.00** | 1.00 |
| 8 | 0.38 | 1.00 |
| 32 | 0.09 | 1.00 |

Six notes or fewer match perfectly with no scaling at all. `expected` is built
at `target_bpm`, so below the crossover the score's own units are simply used.

### An alternative measured and rejected

Estimating the rate from a first DTW pass and refitting — more robust to a
missed note than a median, and it does fix the four-note case. It also **breaks
tempo-invariance**, which is the property the whole normalisation exists for: a
32-note take played 20% fast mapped to written notes 0–26 instead of 0–31,
because the first pass is exactly the sliding match the second pass is supposed
to be estimating from. Not adopted.

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
