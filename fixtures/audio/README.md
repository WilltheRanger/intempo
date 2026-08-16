# The Batch 3 tuning corpus

Six recordings. Not test data — the spec for what good output looks like
(`intempo-combined.md`, Batch 3 Tuning Appendix §3).

**None of them are recorded yet.** Until they are, the tuning dashboard runs on
synthetic click tracks (`make_synthetic.py`), which prove the dashboard and the
pipeline agree but say nothing about whether the thresholds are right. Only a
real instrument in a real room can answer that.

## What to record

Same passage for the first three — same notes, same tempo, same room, same mic
placement. If those change between takes you are tuning against the room, not
the playing.

| File | What | Why it's in the corpus |
|---|---|---|
| `01_detache_clean.wav` | 8 bars of slow détaché, quarter notes at 60 BPM, as close to perfectly in time as you can play it | Ground truth. Nothing else is worth looking at until deviations here are inside ±15 ms. |
| `02_detache_rushing.wav` | Same passage, deliberately rushing — a gradual drift across the 8 bars, not a step change | The clip you read the rushing tolerance band off, by ear |
| `03_detache_dragging.wav` | Same passage, deliberately dragging, same gradual shape | The dragging band, set independently — people tolerate dragging more than rushing |
| `04_slurred.wav` | ≥4 bars, several notes per slur (4-note slurs work) | Where onset detection breaks by design. Recorded to *see* the breakage, not to fix it in v1. |
| `05_open_e_long.wav` | One open E held ~2 s, then silence | Does low-register detection fire at all on the lowest fundamental in the repertoire |
| `06_pizzicato.wav` | ≥4 bars pizzicato | The always-should-work case. Watch for *over*-detection — string ring reading as extra onsets. |

Mono WAV. Any sample rate; the pipeline loads at 22.05 kHz and the header is
believed, so don't resample by hand.

## Then tell the dashboard about them

Each clip needs the score it was played from and the tempo it was aimed at —
the pipeline compares against an expected grid, and without one there is
nothing to deviate from. That lives in `manifest.json` beside the audio:

```json
{
  "id": "01_detache_clean",
  "file": "01_detache_clean.wav",
  "label": "Détaché — clean",
  "target_bpm": 60,
  "double_bass": true,
  "score": { "...": "a ScoreJson, or \"score_file\": \"01.json\"" }
}
```

`manifest.json` already describes all six with the scores the appendix implies
(8 bars of quarters, 4 bars of slurred eighths, and so on). When you record
something different from what it says, edit the manifest — a grid that doesn't
match what you played produces deviations that are real arithmetic about the
wrong thing.

## The regression rule

Every threshold change gets checked against **all six**, not just the clip that
prompted it. The dashboard's overview page exists for this: one row per clip,
onset counts and worst deviation, at whatever parameters are currently loaded.

The classic Batch 3 failure is tweaking `delta` to rescue the slurred clip and
silently losing the open-E onset. It costs one page load to catch.
