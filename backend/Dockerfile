# --- Audiveris, optional -----------------------------------------------------
#
# Built only when the image is built with `--build-arg WITH_AUDIVERIS=1`, and
# left out otherwise: it adds a JDK, a Gradle build and a few hundred megabytes
# to an image whose whole job is to serve HTTP. The API works without it — the
# OMR second opinion is skipped when no engine is on PATH.
#
# See scripts/install-audiveris.sh for why v5.4 and why jai-core is removed.
FROM eclipse-temurin:21-jdk AS audiveris
ARG WITH_AUDIVERIS=0
ARG AUDIVERIS_TAG=v5.4
WORKDIR /src
RUN if [ "$WITH_AUDIVERIS" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
      && rm -rf /var/lib/apt/lists/* \
      && git clone --depth 1 --branch "$AUDIVERIS_TAG" https://github.com/Audiveris/audiveris . \
      && sed -i "/\[group: 'javax.media', name: 'jai-core', version: '1.1.3'\],/d" app/build.gradle \
      && ./gradlew --no-daemon -q installDist \
      && mv "$(dirname "$(dirname "$(find app/build/install -type f -name Audiveris | head -1)")")" /audiveris ; \
    else mkdir -p /audiveris ; fi

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

# Present but empty unless WITH_AUDIVERIS=1, so the COPY always succeeds and
# the runtime image stays the same size when the engine was not asked for.
COPY --from=audiveris /audiveris /opt/audiveris
ARG WITH_AUDIVERIS=0
RUN if [ "$WITH_AUDIVERIS" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
      && rm -rf /var/lib/apt/lists/* ; fi
ENV OMR_COMMAND=/opt/audiveris/bin/Audiveris \
    OMR_ARGS="-batch -export -output {out} -- {image}"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
