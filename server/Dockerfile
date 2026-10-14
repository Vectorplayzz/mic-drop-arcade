# syntax=docker/dockerfile:1.7
# Mic Drop Arcade API — multi-stage, hash-pinned dependencies, non-root, read-only at runtime.

FROM python:3.14-slim-bookworm AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY requirements.lock .
RUN python -m venv /venv \
 && /venv/bin/pip install --no-deps --require-hashes -r requirements.lock

FROM python:3.14-slim-bookworm
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data/audio \
 && chown -R app:app /data
COPY --from=build /venv /venv
WORKDIR /srv
COPY --chown=root:root app ./app
COPY --chown=root:root migrations ./migrations
COPY --chown=root:root content ./content
COPY --chown=root:root packs ./packs
COPY --chown=root:root adventures ./adventures
COPY --chown=root:root scripts ./scripts
ENV PATH=/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MAATA_PACKS_DIR=/srv/packs \
    MAATA_LINES_FILE=/srv/content/lines.json \
    MAATA_ADVENTURES_DIR=/srv/adventures \
    MAATA_WIZARD_LINES_FILE=/srv/content/wizards.json \
    MAATA_AUDIO_CACHE_DIR=/data/audio
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/healthz', timeout=3).status == 200 else 1)"]
# One worker: game sessions are long-lived async sockets; Redis holds all shared state.
CMD ["uvicorn", "app.main:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--ws", "websockets-sansio", "--ws-max-size", "16384", "--ws-ping-interval", "20", \
     "--no-server-header", "--no-proxy-headers", "--no-access-log", \
     "--limit-concurrency", "400", "--timeout-graceful-shutdown", "20"]
