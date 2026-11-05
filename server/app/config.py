"""Runtime configuration.

Every value comes from the environment (or a .env file in development). In production the
settings object refuses to start with weak or missing secrets, so a misconfigured deploy fails
at boot rather than leaking the API key or running with test Turnstile keys.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from ipaddress import ip_network
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Cloudflare's documented always-pass test secret. Allowed in dev/test, never in production.
TURNSTILE_TEST_SECRETS = {
    "1x0000000000000000000000000000000AA",
    "2x0000000000000000000000000000000AA",
    "3x0000000000000000000000000000000AA",
}

LanguageCode = Literal["te-IN", "hi-IN", "hi-en", "en-IN", "te-en"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MAATA_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    env: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # --- Secrets -------------------------------------------------------------------------
    gnani_api_key: SecretStr = SecretStr("")  # speech-to-text (Prisma); also TTS if no key below
    gnani_tts_api_key: SecretStr = SecretStr("")  # text-to-speech (Timbre), when it has its own key
    jwt_secret: SecretStr = SecretStr("")
    ip_hash_secret: SecretStr = SecretStr("")
    turnstile_secret: SecretStr = SecretStr("1x0000000000000000000000000000000AA")
    alert_webhook_url: SecretStr = SecretStr("")  # Discord-compatible webhook, optional

    # --- Gnani endpoints -----------------------------------------------------------------
    gnani_stt_ws_url: str = "wss://api.vachana.ai/stt/v3/stream"
    gnani_tts_ws_url: str = "wss://api.vachana.ai/api/v1/tts"
    gnani_tts_rest_url: str = "https://api.vachana.ai/api/v1/tts/inference"
    # Timbre v3.0: 13 voices that each speak every game language, plus inline audio tags
    # (<laugh>, <sigh>...). Its voices are not v2.5 voices: app/game/languages.py must match.
    gnani_tts_model: str = "timbre-v3.0"
    gnani_connect_timeout_s: float = 6.0
    gnani_connect_retries: int = 3

    # --- Infrastructure ------------------------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"
    database_url: str = "postgresql://maata:maata@localhost:5432/maata"
    audio_cache_dir: str = "/data/audio"
    packs_dir: str = "packs"
    lines_file: str = "content/lines.json"
    adventures_dir: str = "adventures"
    wizard_lines_file: str = "content/wizards.json"

    # --- HTTP surface --------------------------------------------------------------------
    public_origin: str = "http://localhost:5173"
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )
    turnstile_hostname: str = ""  # expected Turnstile hostname(s), comma-separated; empty = skip
    trusted_proxies: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["127.0.0.1/32", "::1/128"]
    )

    # --- Session & abuse limits ----------------------------------------------------------
    session_ttl_s: int = 1800
    score_token_ttl_s: int = 600
    auth_timeout_s: float = 5.0
    max_games_per_session: int = 5
    max_audio_s_per_session: float = 240.0
    max_audio_s_per_ip_day: float = 900.0
    max_concurrent_games: int = 60
    max_client_frame_bytes: int = 8192
    max_control_msg_bytes: int = 2048
    max_control_msgs_per_s: int = 20
    rate_session_per_min: int = 10
    rate_ws_connect_per_min: int = 20
    rate_score_post_per_min: int = 10
    rate_read_per_min: int = 120

    # --- Game ----------------------------------------------------------------------------
    questions_per_game: int = 10
    answer_time_limit_s: float = 12.0
    choice_time_limit_s: float = 15.0
    answer_grace_s: float = 1.0
    stt_min_silence_ms: int = 450
    stt_vad_threshold: float = 0.7
    barge_in_enabled: bool = True

    # --- Credit budget -------------------------------------------------------------------
    # Costs are configurable until Gnani publishes per-unit rates for programme credits.
    credits_total: float = 5000.0
    daily_credit_budget: float = 300.0
    credits_per_stt_minute: float = 1.0
    credits_per_1k_tts_chars: float = 1.0
    kill_switch: bool = False

    @property
    def tts_api_key(self) -> str:
        """The key for Timbre: its own if set, else the shared Gnani key."""
        return self.gnani_tts_api_key.get_secret_value() or self.gnani_api_key.get_secret_value()

    @field_validator("allowed_origins", "trusted_proxies", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str):
            return [part.strip() for part in v.split(",") if part.strip()]
        return v

    @field_validator("trusted_proxies")
    @classmethod
    def _valid_networks(cls, v: list[str]) -> list[str]:
        for net in v:
            ip_network(net, strict=False)
        return v

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        if self.env != "production":
            # Ephemeral secrets keep dev/test runnable without a .env; they rotate every boot.
            if not self.jwt_secret.get_secret_value():
                self.jwt_secret = SecretStr(secrets.token_urlsafe(48))
            if not self.ip_hash_secret.get_secret_value():
                self.ip_hash_secret = SecretStr(secrets.token_urlsafe(48))
            return self
        problems: list[str] = []
        if not self.gnani_api_key.get_secret_value():
            problems.append("MAATA_GNANI_API_KEY is required")
        for name in ("jwt_secret", "ip_hash_secret"):
            if len(getattr(self, name).get_secret_value()) < 32:
                problems.append(f"MAATA_{name.upper()} must be at least 32 characters")
        if self.turnstile_secret.get_secret_value() in TURNSTILE_TEST_SECRETS:
            problems.append("MAATA_TURNSTILE_SECRET is a Cloudflare test key")
        if not self.turnstile_hostname:
            problems.append("MAATA_TURNSTILE_HOSTNAME is required")
        if any(not o.startswith("https://") for o in self.allowed_origins):
            problems.append("MAATA_ALLOWED_ORIGINS must all be https:// in production")
        if not self.public_origin.startswith("https://"):
            problems.append("MAATA_PUBLIC_ORIGIN must be https:// in production")
        if problems:
            raise ValueError("Unsafe production configuration: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
