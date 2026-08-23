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

## Before you press record

**Leave about a second of room tone at the head of each take**, and don't start
playing the instant you tap record. Two reasons, both verified 2026-08-27:

- The lead-in itself is now harmless — it used to sink alignment (a perfect take
  with 5 s of lead-in scored 0.053 and was told to re-record), and that is
  fixed. So take your time settling.
- That second of room tone is what makes the *other* problem visible. The
  detector can fire a spurious onset a few frames into a signal that has a noise
  floor, before any note. The dashboard draws detected marks on the waveform, so
  with a clear head of silence a stray mark ahead of your first note is obvious.
  See `TUNING_LOG.md` 2026-08-27 §3 — this is the first thing to check on
  clip 01.

Same room, same mic placement, same instrument across all six, and especially
across the first three. If those change between takes you are tuning against
the room rather than the playing.

## Format

**Whatever your recorder gives you.** 48 kHz stereo 24-bit WAV was walked
through the whole path end to end and works — librosa resolves it to 22.05 kHz
mono itself. Don't resample or downmix by hand; the header is believed. Phone
recordings in `.m4a` need `ffmpeg` present, which the deployed image has.

The one thing that matters is that it is the take you actually played, uncut at
the front — trimming the head by hand removes the evidence described above.

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

## Once you have recorded one

Drop it in beside this file under the un-suffixed name — `01_detache_clean.wav`
— and it takes over from the stand-in on the next page load. Nothing else to
configure; `load_corpus` prefers a real file over a synthetic one and labels
which is which.

```bash
cd backend
uv run uvicorn tuning_dashboard.app:app --reload --port 8100
```

Then <http://127.0.0.1:8100>. Read it in this order:

1. **Does the detected-onset count match the written one?** If it is short, the
   peak-picking window is the first suspect — `pre_max`/`post_max` are ±464 ms
   and notes closer than that suppress each other, which caps quarter notes at
   about 128 BPM. `TUNING_LOG.md` 2026-08-27 §2.
2. **Is there a mark before your first note?** §3 in the same entry.
3. **Only then** look at the deviation bars. A threshold read off a clip whose
   onsets are wrong is a number about the wrong thing.

Record clip 01 first and stop there. Until deviations on the clean détaché sit
inside ±15 ms there is nothing to learn from the other five.

## The regression rule

Every threshold change gets checked against **all six**, not just the clip that
prompted it. The dashboard's overview page exists for this: one row per clip,
onset counts and worst deviation, at whatever parameters are currently loaded.

The classic Batch 3 failure is tweaking `delta` to rescue the slurred clip and
silently losing the open-E onset. It costs one page load to catch.
