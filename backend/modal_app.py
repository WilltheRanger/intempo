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

**HOMR is here now**, as `transcribe_score` — another `@app.function` with its
own image and its own memory, exactly as this said it would be. It does not
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
#: Model keys are **optional** and only buy the fallback: this container reads
#: pages with homr, which needs none. Adding `ANTHROPIC_API_KEY` here is what
#: lets `parse_sheet_music` fall through to the vision models on a page homr
#: cannot read. Without it, such a page fails — with the reason said plainly,
#: which is the point of `_why_it_failed`.
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
    from app.logging_config import configure_logging
    from app.workers.analysis_runner import run_analysis as run

    configure_logging()
    run(analysis_id)


#: Reading a page, which needs a different container from analysing a take.
#:
#: **Measured on the first real page this project has seen** — a photographed
#: String Bass part, ten systems: homr peaks at **1350 MB** and takes 21 s wall
#: clock, 63 s of CPU. The API instance has 512 MB for the whole application,
#: which is why this is here and not there.
#:
#: The vision providers ride along because `parse_sheet_music` falls back to
#: them when homr finds no staves, and a fallback that needs a different
#: container is not a fallback. They are small — SDK clients, no models.
#:
#: **No GPU.** homr ships ONNX and runs on CPU, and this is deliberately sized
#: to stay inside a free Modal account: one container, no GPU, nothing kept
#: warm.
transcription_image = (
    modal.Image.debian_slim(python_version="3.12")
    # opencv-python-headless still wants these two at import time.
    .apt_install("libglib2.0-0", "libgl1")
    .pip_install(
        "homr==0.7.0",
        "anthropic==0.97.0",
        "google-genai==1.73.1",
        "httpx==0.28.1",
        "numpy==2.4.6",
        "pillow==12.3.0",
        "pillow-heif==1.5.0",
        "pydantic[email]==2.13.3",
        "supabase==2.29.0",
    )
    # **Fetch the weights at build time, not on the first page.**
    #
    # homr downloads ~151 MB of ONNX into its own package directory the first
    # time it runs. Left to happen at run time that is a cold start which
    # downloads 151 MB before it can look at anything — on a scan a musician is
    # watching — and it happens again on every new container, which on
    # `min_containers=0` is most of them.
    .run_commands(
        "python -c 'from homr.main import download_weights; "
        "download_weights(False, False, False)'"
    )
    # **The chain this container exists to run.**
    #
    # `_default_chain()` reads `OCR_PROVIDER_CHAIN` from *this process's*
    # environment, and on Modal that comes from the `intempo-backend` secret —
    # which carries Supabase credentials and nothing else. Unset, the default is
    # `claude-sonnet-5,claude-opus-5`: so a container built specifically to run
    # homr would not have had homr in its chain at all, and would have failed
    # every page on a missing API key. Setting it on the API host, which is
    # where it looks like it belongs, changes nothing here.
    #
    # An image default rather than a hard-coding: a value in the secret still
    # overrides it, because Modal injects secrets over the image environment.
    .env({"OCR_PROVIDER_CHAIN": "homr,gemini-2.5-flash,claude-sonnet-5,claude-opus-5"})
    .add_local_dir(
        "app",
        remote_path="/root/app",
        ignore=["**/tests/**", "**/__pycache__/**", "**/routers/**"],
    )
    .add_local_file("config.toml", remote_path="/root/config.toml")
)


@app.function(
    image=transcription_image,
    secrets=secrets,
    # 1350 MB measured, and a denser page will want more. Room rather than a
    # target: a read that dies of memory costs a musician the photograph, the
    # upload and the wait.
    memory=2560,
    # homr is 21 s on a ten-system page. This is a backstop against a hang.
    timeout=900,
    # A cold start imports onnxruntime and loads 151 MB of weights from the
    # image. Keeping one warm would cost money around the clock to save that on
    # the first scan of a session, and the scan is already asynchronous — the
    # musician is watching a progress screen that says what it is doing.
    min_containers=0,
)
def transcribe_score(score_id: str) -> None:
    """One page, start to finish.

    The *same* function the in-process path runs, for the same reason
    `run_analysis` is: this project has been bitten repeatedly by a second
    implementation that drifted from the first, and a transcription runner that
    exists twice would have two ideas about what is on a musician's page.
    """
    from app.logging_config import configure_logging
    from app.workers.transcription_runner import run_transcription

    # Nothing else in this process does it. `configure_logging` runs in the
    # API's `lifespan`, and there is no lifespan here — so without this the
    # container's own account of what it read ("homr: 74 measures, 267 notes,
    # durations {...}") is thrown away at WARNING, and Modal's log page, which
    # is the only window into this container, shows nothing.
    configure_logging()
    run_transcription(score_id)


@app.local_entrypoint()
def read_page(score_id: str) -> None:
    """Read one page by id, from a terminal.

        modal run modal_app.py::read_page --score-id <uuid>
    """
    transcribe_score.remote(score_id)
    print(f"score {score_id}: read")


@app.local_entrypoint()
def main(analysis_id: str) -> None:
    """Run one analysis by id, from a terminal.

        modal run modal_app.py --analysis-id <uuid>

    For checking the deployment works against a real row, without a phone.
    """
    run_analysis.remote(analysis_id)
    print(f"analysis {analysis_id}: dispatched")
