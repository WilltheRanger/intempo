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

It also runs the same *versions*. The image pins exact ones taken from
`uv.lock` — including `soxr`, `soundfile` and `numba`, which belong to librosa
rather than to us and are where the samples actually move — and a test reads the
lock and checks every pin still matches. Before that the image installed by
lower bound, which resolves to whatever PyPI holds on the day it is built: the
same code and the same config, quietly doing different arithmetic from every
test that says what a musician's timing was. `uv lock` upgrading librosa now
fails CI, and the deploy runs those tests before it deploys.

## Setting it up without a development environment

`modal deploy` is the only way to publish a Modal app, and it needs Python, the
repo and a logged-in CLI — a development environment, kept solely to ship a
change to the analysis. So a GitHub Action does it instead
(`.github/workflows/deploy-modal.yml`): push to `main` and it is live. Nothing
below needs a terminal.

**1. On modal.com** — sign up, then two things in the dashboard.

*Secrets → Create new secret → Custom.* Name it exactly `intempo-backend`, with
two keys:

```
SUPABASE_URL                 https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY    the service_role key
```

This is the **second place that key lives**. It is why the image is narrow — no
`fastapi`, no `uvicorn`, no model SDKs — a container that can only reach
Supabase is a smaller thing to hold a service-role key.

*Settings → API Tokens → New token.* You get a token **id** and a token
**secret**. Copy both now; the secret is shown once.

**2. On GitHub** — the repository → Settings → Secrets and variables → Actions
→ New repository secret. Add them under exactly these names:

```
MODAL_TOKEN_ID
MODAL_TOKEN_SECRET
```

**3. Run the deploy.** The repository → Actions → **Deploy Modal** → Run
workflow. (It also runs by itself whenever anything the worker contains
changes.) Without the two secrets it skips with a note rather than failing —
a red cross on every push in a repo that has not been set up yet is noise.

**4. Check it worked.** modal.com → Apps → `intempo` should list a deployed
`run_analysis`. The Action's log says the same thing.

**5. Turn it on** — on Render, under Environment:

```
ANALYSIS_RUNTIME=modal
```

Saving it redeploys the API, which is when the switch takes effect.

### If you do have a terminal

The same three steps, faster:

```
pip install modal && modal setup
modal secret create intempo-backend SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
cd backend && modal deploy modal_app.py
modal run modal_app.py --analysis-id <uuid>   # one real row, no phone needed
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

**If the `intempo-backend` secret holds the wrong thing**, the job does not die
— and that is the case worth reading twice, because it is the one you can
create by typing. The secret is two key names entered by hand into a dashboard.
Misspell `SUPABASE_SERVICE_ROLE_KEY`, or paste a `SUPABASE_URL` for a different
project, and *everything else still works*: sign-in, scanning, the upload. Only
the analysis is dead.

The worker now **crashes** in both of those cases rather than returning. That
is deliberate. Returning cleanly is indistinguishable from a clean run, so
Modal marked the call **succeeded** — the one screen anybody looks at while
setting this up showed green while no analysis had ever run, the row sat
`queued`, and ten minutes later the musician was told the server had restarted.
None of that was true and retrying did the same thing forever.

So: a red call in **Modal → Apps → intempo → recent calls**, with a message
naming the take and the setting to fix. The musician still gets the sweeper's
"please retry" — there is no database to write a better reason into, which is
the whole problem — but the person who can actually fix it is now looking at
the fix.

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
