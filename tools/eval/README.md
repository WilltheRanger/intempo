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
without writing anything when it's missing, which is the normal state of
this sandbox (no network, no package install) and may be CI's state too —
see `tools/README.md`'s note on checks that have never run there. The
ground-truth JSON itself (`build_ground_truth()`) never depends on
rendering: it's derived purely from the expected timeline
(`backend/app/services/alignment.build_timeline`) and the error config, so
it can be produced, tested and reviewed with no audio toolchain installed.

What rendering does not attempt: vibrato shaping, bowed-string envelopes
beyond the soundfont's own articulation, an accompaniment mix, and phone-mic
degradation (EQ/noise/room/compression) are recorded in the ground truth as
intent (`injected_errors`) but not yet applied to the audio signal — the
MIDI writer only places note on/off events at the labelled onsets. Treat the
current `render_take()` as the plumbing the rest plugs into, not the
finished pipeline; see the open items below.

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

- Vibrato and bowed envelope shaping on render.
- Accompaniment mixing and phone-mic degradation actually applied to the
  rendered signal, not just labelled as intent.
- Feeding the Telemann/Paganini MusicXML once the Scout task produces it —
  today this only consumes the `score` JSON shape, so that piece needs the
  same OCR-shaped conversion every other fixture went through first.
