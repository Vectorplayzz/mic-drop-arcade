"""Question packs: schema, validation and loading.

The same schema is used for Evon-generated starter packs and (later) Creator Mode uploads, so
every pack — whoever wrote it — passes the same checks before it can be played. Only packs with
a named human reviewer are loaded; drafts live in ``packs/drafts`` and are never served.
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.logging import get_logger

log = get_logger(__name__)

PACK_SCHEMA_VERSION = 1
MAX_PACK_BYTES = 256 * 1024

_CONTROL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]")


def clean_text(value: str) -> str:
    """NFC-normalise and strip control and bidi-override characters (spoofing vectors)."""
    value = unicodedata.normalize("NFC", value)
    value = _CONTROL.sub("", value)
    return " ".join(value.split())


ShortText = Annotated[str, StringConstraints(min_length=1, max_length=80)]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{2,47}$")]


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,32}$")]
    prompt: Annotated[str, StringConstraints(min_length=3, max_length=300)]
    answers: list[ShortText] = Field(min_length=1, max_length=10)
    display_answer: ShortText
    kind: Literal["text", "number"] = "text"
    explanation: Annotated[str, StringConstraints(max_length=200)] | None = None

    @field_validator("prompt", "display_answer", "explanation", mode="before")
    @classmethod
    def _clean(cls, v: object) -> object:
        return clean_text(v) if isinstance(v, str) else v

    @field_validator("answers", mode="before")
    @classmethod
    def _clean_answers(cls, v: object) -> object:
        if isinstance(v, list):
            return [clean_text(a) if isinstance(a, str) else a for a in v]
        return v

    @model_validator(mode="after")
    def _numbers_are_numbers(self) -> Question:
        if self.kind == "number":
            for a in self.answers:
                if not re.fullmatch(r"-?\d+(\.\d+)?", a.replace(",", "")):
                    raise ValueError("number questions need numeric answers")
        return self


class Pack(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = Field(alias="schema", default=1)
    id: Slug
    title: Annotated[str, StringConstraints(min_length=3, max_length=60)]
    language: Literal["te-IN", "hi-IN", "hi-en"]
    topic: Annotated[str, StringConstraints(min_length=2, max_length=40)]
    version: int = Field(ge=1)
    source: Literal["evon-v3.3", "hand", "creator"]
    reviewed_by: Annotated[str, StringConstraints(min_length=2, max_length=60)] | None = None
    reviewed_at: date | None = None
    questions: list[Question] = Field(min_length=5, max_length=50)

    @field_validator("title", "topic", mode="before")
    @classmethod
    def _clean(cls, v: object) -> object:
        return clean_text(v) if isinstance(v, str) else v

    @field_validator("questions")
    @classmethod
    def _unique_ids(cls, v: list[Question]) -> list[Question]:
        ids = [q.id for q in v]
        if len(ids) != len(set(ids)):
            raise ValueError("question ids must be unique")
        return v

    @property
    def reviewed(self) -> bool:
        return bool(self.reviewed_by and self.reviewed_at)

    def summary(self) -> dict[str, object]:
        return {
            "id": self.id,
            "title": self.title,
            "language": self.language,
            "topic": self.topic,
            "questions": len(self.questions),
        }


def parse_pack(raw: bytes | str) -> Pack:
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if len(raw) > MAX_PACK_BYTES:
        raise ValueError("pack too large")
    return Pack.model_validate(json.loads(raw))


class PackLibrary:
    def __init__(self, packs: dict[str, Pack]) -> None:
        self._packs = packs

    @classmethod
    def load(cls, directory: str | Path, *, require_review: bool = True) -> PackLibrary:
        packs: dict[str, Pack] = {}
        root = Path(directory)
        for path in sorted(root.glob("*.json")):  # top level only; drafts/ is never loaded
            try:
                pack = parse_pack(path.read_bytes())
            except (ValueError, OSError) as exc:
                log.error("pack_invalid", file=path.name, error=str(exc)[:300])
                continue
            if require_review and not pack.reviewed:
                log.warning("pack_unreviewed_skipped", pack=pack.id)
                continue
            if pack.id in packs:
                log.error("pack_duplicate_id", pack=pack.id)
                continue
            packs[pack.id] = pack
        log.info("packs_loaded", count=len(packs))
        return cls(packs)

    def get(self, pack_id: str) -> Pack | None:
        return self._packs.get(pack_id)

    def list(self, language: str | None = None) -> list[Pack]:
        return [p for p in self._packs.values() if language is None or p.language == language]
