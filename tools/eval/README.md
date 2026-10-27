# Evaluation harness (JERA-563)

`run.py` runs the real `backend/app/services/analysis.analyze()` over every
take a dataset contributes and scores the result against ground truth —
onset precision/recall/F1, alignment accuracy, timing error, intonation
error, wrong/missed-note precision and recall, verdict agreement, false
rush/drag rate on clean takes, and refusals. `harness.py` is where the
scoring happens; `report.py` turns a run into the markdown/JSON report
below; `run_gate.py` is the fast, synthetic-only subset
`tools/preflight.py` and CI run on every push.

```
tools/eval/run.py                # synthetic takes only — always available
tools/eval/run.py --urmp         # + URMP, once fetch_urmp.py has populated it
tools/eval/run_gate.py           # the regression gate, against baseline/synthetic.json
tools/eval/run_gate.py --update  # after a deliberate grading change — log it
                                  # in TUNING_LOG.md first
```

## Datasets

**`datasets/synthetic.py`** — always available. Twelve hand-curated
scenarios over `synthetic_takes.py`'s generator (one per injected-error
type, plus clean and mixed takes), rendered to a plain-tone waveform by
`synth_audio.py`. Nothing here is committed audio; everything is generated
at run time from the score fixtures already in the repo. See the section
below for what the generator does and does not model — in particular, its
plain sine-wave renderer is good enough to exercise every metric but is not
a substitute for a real recording, and the baseline numbers below should be
read with that in mind (a detector tuned against bowed-string attacks will
not always find a clean attack in a continuous harmonic tone).

**`datasets/urmp.py`** — real recordings, eval-only, never committed. URMP
(University of Rochester Multi-Modal Music Performance dataset) is **CC BY
4.0** — see
<https://www.ece.rochester.edu/projects/air/projects/URMP.html>. Per
Lens's JERA-560 research: manually-corrected note-level ground truth
(pYIN via Tony, hand-checked), professional/conservatory performers,
studio conditions — a strong *independent* reference for pitch-tracker and
onset accuracy, and a ceiling measurement rather than a phone-mic
robustness test. Bach10 (non-commercial license) and MusicNet
(piano-skewed) were considered and skipped, per that research and the
user's direction. Violin Etudes (Tamer et al., ISMIR 2022, Zenodo
10.5281/zenodo.6564408, also CC BY 4.0) is the second real dataset for
scale once URMP's numbers look right — not yet wired into
`datasets/`, since URMP alone already gives independently-verified ground
truth and Violin Etudes' f0 labels are automatic rather than
hand-corrected (lower-confidence ground truth, better suited to a
volume/generalisation check than a first baseline).

### Getting the data

**The official 12.5 GB release is gated behind a Google Form on the project
page, not a plain URL** — a human fills it in and gets a download link by
email, the same shape as this codebase's magic-link auth gate elsewhere:
not something a session can do on anyone's behalf. `fetch_urmp.py` instead
pulls the same CC-BY-4.0-licensed files, piece by piece, from a
long-standing third-party mirror that reproduces the official layout
exactly (see its docstring for the exact URL and the files it does and does
not fetch — never the videos, never a non-violin instrument's audio). The
mirror's files have since been checked, file by file, against the official
release — see "Provenance and integrity" below; the Google Form is still
the official route, and still a human step.

```
tools/eval/fetch_urmp.py
```

Populates `intempo-eval-data/urmp/` (outside the repository, gitignored at
the workspace root) with four pieces — a violin/cello duet, a two-violin
duet, and two quartets, a deliberately small first slice rather than the
full 44-piece corpus. Add to `PIECES` in that file and re-run to grow it.

### Provenance and integrity (JERA-578)

**The mirror was checked against the official release on 2026-10-27, and all
eighteen files are byte-identical.** Every URMP take is therefore in the
baseline; nothing is held out.

How it was checked, since "a mirror says it is URMP" is not evidence: the
authors deposited the dataset themselves — Li, Liu, Dinesh, Duan and Sharma,
the same five as the TMM paper (`doi:10.1109/TMM.2018.2856090`) — in Dryad
(`doi:10.5061/dryad.ng3r749`), mirrored as **Zenodo record 5034983**, which
publishes an md5 for the whole archive. That archive was downloaded
(12,097,672,571 bytes), its md5 matched
(`8452b1a734fad6f3c10bd19940bc09b4`), and the eighteen members the fetch
pulls were hashed out of it and compared with what was already on disk.
Sizes agree too, but sizes are the weak form of this check; the table is
`sha256`.

| Piece | File | Official size | Mirror size | sha256 |
|---|---|---|---|---|
| 01_Jupiter_vn_vc | `AuSep_1_vn_01_Jupiter.wav` | 9,023,456 | 9,023,456 | match |
| 01_Jupiter_vn_vc | `Notes_1_vn_01_Jupiter.txt` | 2,108 | 2,108 | match |
| 01_Jupiter_vn_vc | `Sco_01_Jupiter_vn_vc.mid` | 1,463 | 1,463 | match |
| 02_Sonata_vn_vn | `AuSep_1_vn_02_Sonata.wav` | 6,630,668 | 6,630,668 | match |
| 02_Sonata_vn_vn | `AuSep_2_vn_02_Sonata.wav` | 6,630,668 | 6,630,668 | match |
| 02_Sonata_vn_vn | `Notes_1_vn_02_Sonata.txt` | 1,873 | 1,873 | match |
| 02_Sonata_vn_vn | `Notes_2_vn_02_Sonata.txt` | 1,144 | 1,144 | match |
| 02_Sonata_vn_vn | `Sco_02_Sonata_vn_vn.mid` | 1,324 | 1,324 | match |
| 12_Spring_vn_vn_vc | `AuSep_1_vn_12_Spring.wav` | 18,854,078 | 18,854,078 | match |
| 12_Spring_vn_vn_vc | `AuSep_2_vn_12_Spring.wav` | 18,854,078 | 18,854,078 | match |
| 12_Spring_vn_vn_vc | `Notes_1_vn_12_Spring.txt` | 10,002 | 10,002 | match |
| 12_Spring_vn_vn_vc | `Notes_2_vn_12_Spring.txt` | 7,816 | 7,816 | match |
| 12_Spring_vn_vn_vc | `Sco_12_Spring_vn_vn_vc.mid` | 9,562 | 9,562 | match |
| 24_Pirates_vn_vn_va_vc | `AuSep_1_vn_24_Pirates.wav` | 7,173,611 | 7,173,611 | match |
| 24_Pirates_vn_vn_va_vc | `AuSep_2_vn_24_Pirates.wav` | 7,173,611 | 7,173,611 | match |
| 24_Pirates_vn_vn_va_vc | `Notes_1_vn_24_Pirates.txt` | 3,023 | 3,023 | match |
| 24_Pirates_vn_vn_va_vc | `Notes_2_vn_24_Pirates.txt` | 1,991 | 1,991 | match |
| 24_Pirates_vn_vn_va_vc | `Sco_24_Pirates_vn_vn_va_vc.mid` | 5,098 | 5,098 | match |

18 files, 18 identical, 0 mismatches, 0 unverified. The audio also reads
back as what URMP documents it to be — mono, 48 kHz, 24-bit — with every
annotation file's last note ending inside its recording.

**That one-off download is distilled into `urmp_checksums.txt`, which is
committed and is what runs from now on.** `fetch_urmp.py` checks every file
it fetches or finds against it and exits non-zero on a mismatch;
`datasets/urmp.py` re-checks the tree on load and drops any take one of
whose three files does not match, warning with the file names. So the rule
for anything that *cannot* be verified is enforced rather than remembered: a
piece added to `PIECES` without a manifest entry loads as `unverified` and
stays out of the numbers until someone extends the manifest the way its
header describes. Re-verifying from scratch means another 12.1 GB download —
the manifest exists so that nobody has to.

Two smaller things that came out of reading the official release:

- **The license is stated two ways.** The project page says CC BY 4.0; the
  authors' Dryad/Zenodo deposit of the same data says CC0 1.0. Either
  permits the eval-only use here, and attribution is recorded either way.
- **The official release has two files the fetch skips**, and one bears on a
  caveat below: `F0s_<n>_<inst>_<piece>.txt`, a frame-level f0 track
  (~10 ms hop) next to the note-level `Notes_*`, which would give intonation
  a per-frame reference instead of a per-note one; and `Sco_<piece>.pdf`,
  the engraved score — the thing "reconstructed, not sourced from an
  engraving" below says we do not have. It is a page image, so it is OCR
  input, not a `ScoreJson`. Neither is wired in; whether either is worth it
  is a separate call, not a gap in this fetch.

### What URMP's ground truth is, and is not

`Notes_<n>_vn_<piece>.txt` is a flat, unindexed list of the notes a
violinist actually played (onset, Hz, duration) — it has no correspondence
to this pipeline's own written-score note indices, because a real player
does not attack notes at the written score's positions the way the
synthetic generator's ground truth does by construction. The harness scores
onset accuracy against it *by time* (exactly the independent check Lens's
research recommends), and reads `AnalysisResult` as a real pipeline run for
everything else — it does not try to force URMP's ground truth into
`SCHEMA.md`'s synthetic shape. Two consequences:

- **No rush/drag ground truth.** URMP's performers are not playing to a
  metronome; a steady-tempo verdict direction has no independent answer to
  compare against here, so `verdict_agreement_rate` and
  `false_rush_drag_rate` are not scored on URMP takes — only
  onset/alignment/intonation are. The synthetic dataset is what the
  regression gate watches for exactly this reason.
- **The written score is reconstructed, not sourced from an engraving.**
  `datasets/midi_score.py` reads `Sco_<piece>.mid` directly (no `mido`/
  `pretty_midi` dependency — a from-scratch Standard MIDI File reader, a
  couple hundred lines, since this is the only caller) and quantizes
  performed durations to the nearest notated value to build a `ScoreJson`.
  Onset times drift by a few milliseconds from quantization error
  accumulated across a piece — well inside the default 50 ms onset
  tolerance, but worth knowing before reading a borderline number as exact.

## Synthetic ground-truth takes (JERA-562)

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
