# Running the analysis on Modal

The API stays on Render. The heavy work moves.

## Why

The instance the API runs on has **512 MB for the whole application**. One
analysis peaks near **460 MB** — measured, on a fourteen-minute take, after the
filter and the onset envelope were already cut from 377 MB and 540 MB to 90 and
52. So:

- two musicians finishing takes within a few seconds of each other is an
  out-of-memory kill, and
- `BackgroundTasks` runs **in the web process**, so that kill takes sign-in down
  with it rather than just the analysis, and
- an OMR model alongside it does not fit at any size.

None of that is fixable by tuning. It is a box that is too small for two jobs.

## What moves, and what does not

| | where |
|---|---|
| auth, CRUD, enqueue, polling | Render — all light |
| `run_analysis` (fetch, analyse, write) | Modal |
| `analyze()` itself | **unchanged, still a plain function** |

That last row matters. 700 backend tests, the six-clip corpus regression and
`python -m tuning_dashboard.cli` all run `analyze()` locally with no network. If
Modal were the only path, tuning thresholds against real recordings would need a
deploy — exactly backwards for the thing that most needs a fast loop.

Modal runs *the same* `run_analysis`, imported, not reimplemented. A second
analysis runner would be the worst version of a failure this project has had
four times: two implementations disagreeing about a musician's timing, with
nothing to say which produced a given result. There is a test asserting the
import.

## Setting it up

**1. Install and log in.**

```
uv pip install modal
modal setup
```

**2. Give it the two things it needs.** The worker talks to Supabase and
nothing else.

```
modal secret create intempo-backend \
    SUPABASE_URL=... \
    SUPABASE_SERVICE_ROLE_KEY=...
```

This is the **second place that key lives**. It is why the image is narrow — no
`fastapi`, no `uvicorn`, no model SDKs — a container that can only reach
Supabase is a smaller thing to hold a service-role key.

**3. Deploy.**

```
cd backend
modal deploy modal_app.py
```

**4. Check it against a real row**, without a phone:

```
modal run modal_app.py --analysis-id <uuid>
```

**5. Turn it on** — set on Render, under Environment:

```
ANALYSIS_RUNTIME=modal
```

Anything else, including unset, keeps the work in-process. The comparison is
exact: `MODAL`, `true`, `yes` and a stray space all mean in-process, because a
typo must not silently move where the work runs.

## What happens when it goes wrong

**If Modal refuses the job — not deployed, secret missing, unreachable, package
not installed — the take runs in-process instead**, and the refusal is logged.
A musician who has just finished playing should not lose the take to a
deployment setting. A slow analysis on a tight box is a far better outcome than
none.

That fallback is also the thing to watch: a deployment that *thinks* it is on
Modal and is quietly running everything locally looks fine until two people
record at once. `analysis %s: falling back to in-process` in the Render log is
the line that says so.

**If the job dies on Modal**, the row stays `processing` and the stuck-row
sweeper marks it `failed_recoverable` — the same failure the in-process path has
always had, and the same recovery. Nothing new to build.

## Cost

An analysis is 1.5–4.5 seconds at 2 GB. Modal bills per second of container
time, and containers scale to zero between takes. At hundreds of analyses a day
this is dollars, and the free credit covers the early months.

`min_containers=0` — nothing is kept warm. A cold start is a second or two of
import, and the take is already asynchronous: the musician is watching a
progress screen, not a spinner on a request.

## Adding HOMR

Another `@app.function` in `modal_app.py`, with its own image and its own
memory. It does not touch the analysis, and the API reaches it the same way —
through `dispatch`, which exists so that no request handler knows where work
runs. That is the whole reason the shape is worth having.
