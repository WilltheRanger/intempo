# Synthetic ground-truth takes

`synthetic_takes.py` turns a score JSON fixture into a labelled "take":
a timeline of expected vs. played note onsets and pitches, with chosen
errors injected on purpose, plus the JSON ground truth `SCHEMA.md`
describes. It is how JERA-562 proposes to get data the grading pipeline can
be tuned against without waiting on real recordings — see
`TUNING_LOG.md` and the parent program issue (JERA-559) for why that
matters.

## What's committed vs. what isn't

Committed: the generator, this spec, and `fixtures/eval/tiny_phrase.json` —
a four-note synthetic score fixture, seconds long, used only by
`test_synthetic_takes.py`.

**Never committed: rendered audio, or any MIDI file derived from a real
piece.** `render_take()` writes outside the repository by construction (the
caller picks `out_wav`, and nothing here defaults it into the tree); the
ground truth JSON for a real piece's take is data, not code, and belongs in
`/paperclip/workspaces/intempo-eval-data/` per the program's ground rules,
not in version control.

## The soundfont

Rendering uses the violin bank already in this repo —
`mobile/assets/soundfonts/violin.sf2` — rather than sourcing a new one. It's
built from **VS Chamber Orchestra 2: Community Edition**, released CC0 1.0;
see `mobile/assets/soundfonts/NOTICE.md` and `VSCO-LICENSE.txt` for the full
terms and provenance. Nothing new is added or redistributed by this tool.

## Rendering is best-effort

`render_take()` needs a `fluidsynth` binary on `PATH`; it returns `False`
without writing anything when it's missing. This sandbox now has
`fluidsynth` installed, and the render path is exercised by
`test_synthetic_takes.py`'s `test_render_take_*` tests (skipped, not failed,
on a machine without the binary — see `tools/README.md`'s note on checks
that have never run in CI). The ground-truth JSON itself
(`build_ground_truth()`) never depends on rendering: it's derived purely
from the expected timeline (`backend/app/services/alignment.build_timeline`)
and the error config, so it can be produced, tested and reviewed with no
audio toolchain installed.

**JERA-562 shipped this gated on a binary nobody had run it against.** The
first real render was silent: channel 0 defaults to GM program 0 (Grand
Piano), and none of the bundled soundfonts carries a preset there, so
`fluidsynth` logged "No preset found on channel 0" and wrote 90 dB of
16-bit quantization noise. `_write_midi` now opens every track with a
Program Change to the instrument's own GM number (`_GM_PROGRAM`); see
`test_render_take_actually_renders_audible_sound`, which is the test that
would have caught it.

Every effect `injected_errors` could already name is now applied to the
signal, not just labelled:

- **Vibrato** is driven into the render as MIDI pitch-bend events around
  each note's on/off pair (`_vibrato_bend_events`) — fluidsynth's own
  soundfont resynthesizes it, rather than a DSP pitch-shift bolted on after.
- **Bow envelope** re-shapes each note's rendered samples with an
  attack/decay ramp (`_apply_bow_envelope`), since a struck-note soundfont's
  own envelope doesn't sound bowed.
- **Accompaniment** (`"piano"` or `"drone"`) is synthesised directly
  (`_synth_tone`/`_mix_accompaniment`) rather than reaching for a second
  soundfont, and mixed in at the stated `level_db` by RMS ratio.
- **Phone-mic degradation** band-limits, adds noise at a stated SNR, adds a
  light synthetic room reverb, and compresses — in that order
  (`_apply_degradation`) — all parameters recorded on the `Degradation`
  dataclass, including the RNG `seed`, so a stored take's audio is
  reproducible from its ground truth alone.

Onset fidelity — does the render actually land where the ground truth says
— is covered against both `fixtures/musicxml/orchestral_part.musicxml` and
a real JERA-568 reference piece
(`test_render_take_matches_a_real_jera_568_reference_score`, skipped if
`intempo-eval-data/` isn't checked out next to this repo) by
`test_render_take_onsets_match_ground_truth_within_a_few_ms`: a plain
amplitude-threshold onset detector, not spectral onset detection, because
this generator already knows exactly when each note was told to start —
the open question is only how much latency the soundfont render adds
(observed: a few ms, consistent take to take).

A real piece's MusicXML (e.g. `intempo-eval-data/scores/<id>/reference.musicxml`)
can be fed straight into `build_ground_truth`/`render_take` — `_load_score`
dispatches on the file suffix, so a `Path` ending `.musicxml`/`.xml` goes
through the OCR pipeline's own `score_json_from_musicxml` instead of the
`{"score": ...}` fixture-JSON shape.

`tools/eval/build_benchmark_set.py` builds a small benchmark set — 5 real
pieces (JERA-568 reference scores, truncated to their first 24 measures) x
5 conditions (clean/rushed/out_of_tune/accompanied/phone) — into
`intempo-eval-data/synthetic/`; see that directory's own `README.md`.

## Schema

See `SCHEMA.md`. It's versioned (`schema_version`) so a harness reading
stored ground truth can tell which shape it's getting.

## Usage

```python
from pathlib import Path
from synthetic_takes import TakeConfig, TimingOffset, build_ground_truth

cfg = TakeConfig(target_bpm=90, errors=[TimingOffset(global_index=4, ms=60)])
ground_truth = build_ground_truth(Path("fixtures/scores/01_simple.json"), cfg)
```

## Open for follow-up (not blocking this generator)

- `_load_score` raises on a multi-part MusicXML file with no `part`
  threaded through — fine for every JERA-568 reference piece so far (all
  solo-violin, single-part), not yet wired up as a `TakeConfig` option for
  a file that needs one (`fixtures/musicxml/violin_duo.musicxml`, e.g.).
- Vibrato and bow envelope are take-level (every sounded note gets the same
  treatment) rather than scoped to a phrase or note range the way
  `IntonationOffset`/`TimingOffset` can be — see `SCHEMA.md`'s design notes
  for why that's a deliberate v1 choice, not an oversight.
- The accompaniment synth (`_synth_tone`) is a plain sine+harmonics voice,
  not a sampled piano — good enough to test that a mix at a stated level
  doesn't swamp the melody, not a listening reference.
