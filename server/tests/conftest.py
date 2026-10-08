from __future__ import annotations

import asyncio
import os
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
import uvicorn
from redis import Redis as SyncRedis

from app.config import Settings
from app.main import create_app
from tests.mock_gnani import API_KEY, MockGnani

SERVER_DIR = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
ORIGIN = "http://test.local"

REDIS_URL = os.environ.get("MAATA_TEST_REDIS_URL", "redis://127.0.0.1:6379/15")
DATABASE_URL = os.environ.get("MAATA_TEST_DATABASE_URL", "")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def gnani() -> Iterator[MockGnani]:
    mock = MockGnani().start()
    yield mock
    mock.stop()


@pytest.fixture
def clean_gnani(gnani: MockGnani) -> MockGnani:
    from tests.mock_gnani import MockState

    gnani.state.__dict__.update(MockState().__dict__)
    return gnani


@pytest.fixture
def redis_sync() -> Iterator[SyncRedis]:
    r = SyncRedis.from_url(REDIS_URL)
    try:
        r.ping()
    except Exception:
        pytest.skip("Redis not available (set MAATA_TEST_REDIS_URL)")
    r.flushdb()
    yield r
    r.flushdb()
    r.close()


@pytest.fixture
def database_url() -> str:
    if not DATABASE_URL:
        pytest.skip("Postgres not available (set MAATA_TEST_DATABASE_URL)")
    import asyncpg

    async def reset() -> None:
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            await conn.execute("DROP TABLE IF EXISTS scores, schema_migrations")
        finally:
            await conn.close()

    asyncio.run(reset())
    return DATABASE_URL


def turnstile_transport(request: httpx.Request) -> httpx.Response:
    if request.url.host == "challenges.cloudflare.com":
        form = dict(x.split("=", 1) for x in request.content.decode().split("&"))
        if form.get("response") == "pass":
            return httpx.Response(
                200, json={"success": True, "hostname": "test.local", "action": "start"}
            )
        return httpx.Response(200, json={"success": False, "error-codes": ["invalid"]})
    return httpx.Response(204)


def make_settings(tmp_path: Path, gnani: MockGnani, database_url: str, **over) -> Settings:
    base = dict(
        env="test",
        log_level="WARNING",
        gnani_api_key=API_KEY,
        gnani_stt_ws_url=gnani.stt_url,
        gnani_tts_ws_url=gnani.tts_url,
        gnani_connect_retries=1,
        redis_url=REDIS_URL,
        database_url=database_url,
        audio_cache_dir=str(tmp_path / "audio"),
        packs_dir=str(FIXTURES / "packs"),
        lines_file=str(SERVER_DIR / "content" / "lines.json"),
        adventures_dir=str(FIXTURES / "adventures"),
        wizard_lines_file=str(SERVER_DIR / "content" / "wizards.json"),
        choice_time_limit_s=4.0,
        allowed_origins=[ORIGIN],
        public_origin=ORIGIN,
        questions_per_game=2,
        answer_time_limit_s=4.0,
        answer_grace_s=0.3,
        stt_min_silence_ms=300,
    )
    base.update(over)
    return Settings(**base)


class LiveServer:
    def __init__(self, settings: Settings) -> None:
        self.port = _free_port()
        app = create_app(
            settings,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(turnstile_transport)),
        )
        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=self.port,
            ws="websockets-sansio",
            ws_max_size=16384,
            server_header=False,
            log_level="warning",
            lifespan="on",
        )
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    @property
    def http(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def ws(self) -> str:
        return f"ws://127.0.0.1:{self.port}/ws/play"

    def __enter__(self) -> LiveServer:
        self.thread.start()
        deadline = time.time() + 15
        while not self.server.started:
            if time.time() > deadline or not self.thread.is_alive():
                raise RuntimeError("server failed to start")
            time.sleep(0.05)
        return self

    def __exit__(self, *exc: object) -> None:
        self.server.should_exit = True
        self.thread.join(10)


@pytest.fixture
def live(tmp_path, clean_gnani, redis_sync, database_url):
    def start(**over) -> LiveServer:
        return LiveServer(make_settings(tmp_path, clean_gnani, database_url, **over))

    return start
