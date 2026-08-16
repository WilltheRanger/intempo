# InTempo Audio Tuning Log

Populated during Batch 3. Format spec: see "Batch 3 Tuning Appendix"
in intempo-combined.md. Every threshold change logs old value, new
value, regression results across all six fixture clips, and rationale.

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
