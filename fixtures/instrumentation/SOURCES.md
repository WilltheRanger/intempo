# Solo-violin instrumentation benchmark

`solo_violin_benchmark.json`: derived spectral metrics and a visual-review
label for 50 solo-violin YouTube performances, extracted from a read-only,
off-repo analysis (`claude_analysis/manifest.jsonl` in a separate workspace;
not part of this repository). **No audio, frames or video from that set are
here or ever were** — only four numbers per video: its id, the reviewer's
instrumentation label, and the two spectral shares `instrumentation_signal.
low_band_signal` also computes.

`instrumentation_assessment` is **not a verified label**. It is one reviewer's
judgement from sampled video frames (the score on screen) and the same
spectral heuristic this fixture's numbers come from — not a listened-to
confirmation of what instruments sound on the track, and 0 of the 50 are a
confirmed ground truth. Treat it as a benchmark for whether the heuristic in
`instrumentation_signal.py` agrees with a plausible outside read, not as
training data to fit thresholds tightly against.

Labels: `consistent_with_solo_violin` (37), `accompaniment_or_backing_likely`
(5), `sub_violin_range_content` (4, incl. one guitar transcription),
`uncertain` (4, left out of the benchmark test — the reviewer wasn't sure
either).

Regenerate with the extraction one-liner in this file's commit message if the
source analysis changes; there is no script checked in here because the
source tree it reads is not part of this repository.
