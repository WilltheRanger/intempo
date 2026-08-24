# The API image. Python only — there is no OMR engine in it any more.
#
# An Audiveris stage lived here behind `--build-arg WITH_AUDIVERIS=1`. It was
# removed with the engine: measured against the fixtures it found fewer
# measures than the vision model already found, and it wanted a 2 GB host to do
# it. See DECISIONS.md, 2026-08-25.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/usr/local

COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /uvx /usr/local/bin/

WORKDIR /app

COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-install-project --no-dev || uv sync --no-install-project --no-dev

COPY app ./app

# The tuning config, and it is not optional.
#
# `audio_config.CONFIG_PATH` is `parents[2]` of `app/services/audio_config.py`,
# which in this image is `/app` — so the loader looks for `/app/config.toml`
# and this line is the only thing that puts one there. Without it the API boots
# cleanly, passes its health check, signs people in and reads photographed
# pages, and then **fails every single analysis** with `internal_error`: the
# config is read lazily, inside the pipeline, and a missing one raises rather
# than falling back to built-in defaults. Calibration goes with it.
#
# It was missing. The Modal image had a test asserting this exact placement and
# the image that has been in production all along had nothing.
COPY config.toml ./config.toml


EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
