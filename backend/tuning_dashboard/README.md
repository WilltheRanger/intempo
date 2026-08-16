# The Batch 3 tuning dashboard

A local readout for the audio pipeline. Not part of the API, not deployed, not
importable by it — `app/` never imports `tuning_dashboard/`; the dependency
runs one way only.

```bash
cd backend
uv run uvicorn tuning_dashboard.app:app --reload --port 8100
```

Then <http://127.0.0.1:8100>.

## Why it exists

Every other batch has a success condition that can be checked automatically.
Batch 3's is *"does this sound right to a musician"*, and the loop for that
without a readout is: edit a number, re-run, read JSON, reconstruct what went
wrong, guess again — about ten minutes a turn, degrading as you tire. Over the
~80 turns a real tuning pass takes, that is the difference between two days and
two weeks.

The appendix in `intempo-combined.md` is blunt about it: build this before
touching a threshold, not after.

## The two pages

**`/` — one clip.** Waveform with detected onsets marked in red above and the
expected grid in blue below; deviation per note as a bar chart, coloured by
tolerance band; the counts that matter (detected, expected, matched, missed,
extra, quality); and the numbers pre-formatted for pasting into a tuning
prompt.

**`/overview` — all six.** One row per clip at the current parameters. This is
what makes the appendix's regression rule cheap enough to actually follow:
every threshold change gets checked against all six, not just the clip that
prompted it. Tweaking `delta` to rescue the slurred clip and silently losing
the open-E onset is the classic Batch 3 mistake, and it shows up here for the
cost of one page load.

## Comparing candidates

Any tunable can be overridden per-request:

```
/?clip=01_detache_clean&onset.delta=0.05
/overview?onset.delta=0.09
```

Sections are `onset`, `tolerance`, `trend`, `alignment` — the sidebar lists
every field, and an overridden one is highlighted.

**Nothing is written back.** A value that wins gets moved into `config.toml` by
hand, with a `TUNING_LOG.md` entry recording the old value, the new one, and
the clip-by-clip regression. The entry is the point; a query string is not a
record of why something changed.

A name that isn't a tunable is a **400**, deliberately. `?onset.detla=0.05`
silently ignored would render a completely convincing page for a parameter that
never moved, which is the worst thing a measurement tool can do.

## The corpus

`fixtures/audio/` — see its README. Six recordings, none of them made yet.
Until they are, the dashboard runs on synthetic click tracks and says
`synthetic` beside every clip that came from one.

**The stand-ins cannot tell you whether a threshold is right.** What they have
is exact known onset times, which is enough to show that the dashboard and the
pipeline agree. What they don't have is bow noise, room reflection, a bass's
slow attack, or string ring — which is the entire thing a threshold has to
survive.

## How it relates to the pipeline

`app/services/diagnostics.py` runs the same functions `analyze()` runs, in the
same order, with the same config object. It is not a second implementation, and
`test_diagnostics.py` pins that: same status, same verdict, same quality, same
per-note deltas. If those ever diverge, tuning is being done against a model of
the pipeline rather than the pipeline itself, and every number that comes out
of it is suspect.
