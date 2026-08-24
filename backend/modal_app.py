"""InTempo's heavy work, off the web box.

    modal deploy modal_app.py

**Why this exists.** The API runs on an instance with 512 MB for the whole
application. One analysis peaks near 460 — measured, on a fourteen-minute take
— so two musicians finishing within a few seconds of each other is an
out-of-memory kill, and `BackgroundTasks` runs *in the web process*, so it
takes sign-in down with it rather than just the analysis. An OMR model
alongside that does not fit at any size.

**What runs here.** The whole job, not just the arithmetic: fetch the row,
download the recording, analyse it, write the result back. The `analyses` row
is the state on both sides, so nothing new has to be invented to track a call
— and the stuck-row sweeper already understands a job that never finished.

**What deliberately does not.** `analyze()` itself is untouched and still a
plain function. 692 tests, the six-clip corpus regression and
`python -m tuning_dashboard.cli` run it locally with no network, and that has
to keep working: tuning thresholds against real recordings is the thing that
most needs a fast loop, and a loop that goes through a deploy is not one.

**Adding HOMR later** is another `@app.function` in this file with its own
image and its own memory — that is the whole point of the shape. It does not
touch the analysis, and the API reaches it the same way.
"""

from __future__ import annotations

import modal

APP_NAME = "intempo"

#: Everything `analyze()` and the worker need, and nothing the web app needs.
#:
#: No `fastapi`, no `uvicorn`, no `anthropic`, no `google-genai`: this container
#: never serves a request or reads a page.
#:
#: **Exact versions, taken from `uv.lock`, and a test that keeps them there.**
#: This said `>=` and claimed in the same breath that "a version that changes an
#: onset by a frame cannot arrive here without arriving in the tests too". Lower
#: bounds do not pin anything. The tests, the six-clip corpus regression and
#: Render all run the *locked* versions; a `>=` image resolves to whatever PyPI
#: has on the day it is built. The two agree today only because the lock has not
#: moved off the bounds yet — the first librosa point release would have made
#: this container quietly disagree with every test that says what a musician's
#: timing was.
#:
#: `test_worker_image.py` reads `uv.lock` and asserts each pin still matches, so
#: `uv lock` upgrading librosa fails CI here rather than shipping.
#:
#: The three below the line are librosa's, not ours, and are pinned because they
#: are where the samples actually move: `soxr` resamples every take to 22.05 kHz,
#: `soundfile` decodes it, `numba` compiles the paths that find the onsets.
#: Everything *they* pull in still floats — this is a fence around the arithmetic,
#: not a reproducible build.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libsndfile1")  # soundfile's C library; not in slim
    .pip_install(
        "httpx==0.28.1",
        "librosa==0.11.0",
        "numpy==2.4.6",
        "pydantic[email]==2.13.3",
        "scipy==1.18.0",
        "supabase==2.29.0",
        # librosa's, pinned for the reason above.
        "numba==0.66.0",
        "soundfile==0.14.0",
        "soxr==1.1.0",
    )
    # The application code, minus the parts a worker has no business running.
    .add_local_dir(
        "app",
        remote_path="/root/app",
        ignore=["**/tests/**", "**/__pycache__/**", "**/routers/**"],
    )
    .add_local_file("config.toml", remote_path="/root/config.toml")
)

app = modal.App(APP_NAME, image=image)

#: The service-role key, the project URL, and the audio settings.
#:
#: Created once with:
#:
#:     modal secret create intempo-backend \
#:         SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
#:
#: This is the second place that key lives, and it is the reason to keep the
#: image narrow: a container that cannot make an outbound call to anything but
#: Supabase is a smaller thing to hold a service-role key.
secrets = [modal.Secret.from_name("intempo-backend")]


@app.function(
    secrets=secrets,
    # Comfortably above the 460 MB a fourteen-minute take peaked at, which is
    # the longest the recorder can now produce. Room rather than a target: an
    # analysis that dies of memory leaves a musician with nothing, and memory
    # here is billed by the second it is actually used.
    memory=2048,
    # Long enough for the slowest measured analysis several times over. The
    # work itself is seconds; this is a backstop against a hang, not a budget.
    timeout=600,
    # A cold start is a second or two of import. Keeping one warm would cost
    # money to save that on the first take of a session, and the take is
    # already asynchronous — the musician is watching a progress screen, not a
    # spinner on a request.
    min_containers=0,
)
def run_analysis(analysis_id: str) -> None:
    """One take, start to finish.

    Deliberately the *same* function the in-process path runs. Not a copy with
    the same name — the import below is the real one. This project has been
    bitten four separate times by a second implementation that drifted from the
    first, and an analysis runner that exists twice would be the worst of them:
    the two would disagree about a musician's timing and nothing would say so.
    """
    from app.workers.analysis_runner import run_analysis as run

    run(analysis_id)


@app.local_entrypoint()
def main(analysis_id: str) -> None:
    """Run one analysis by id, from a terminal.

        modal run modal_app.py --analysis-id <uuid>

    For checking the deployment works against a real row, without a phone.
    """
    run_analysis.remote(analysis_id)
    print(f"analysis {analysis_id}: dispatched")
