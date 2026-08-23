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


EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
