"""Question packs: schema, validation and loading.

The same schema is used for Evon-generated starter packs and hand-written ones, so
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
    # Three on-screen choices (the right one plus two plausible wrong ones). Players still
    # answer by voice; saying a wrong option, or several, counts as wrong. Optional, so
    # open-answer packs keep working.
    options: list[ShortText] | None = Field(default=None, min_length=3, max_length=3)

    @field_validator("prompt", "display_answer", "explanation", mode="before")
    @classmethod
    def _clean(cls, v: object) -> object:
        return clean_text(v) if isinstance(v, str) else v

    @field_validator("options", mode="before")
    @classmethod
    def _clean_options(cls, v: object) -> object:
        if isinstance(v, list):
            return [clean_text(o) if isinstance(o, str) else o for o in v]
        return v

    @field_validator("answers", mode="before")
    @classmethod
    def _clean_answers(cls, v: object) -> object:
        if isinstance(v, list):
            return [clean_text(a) if isinstance(a, str) else a for a in v]
        return v

    @model_validator(mode="after")
    def _options_hold_one_right_answer(self) -> Question:
        if self.options is None:
            return self
        from app.game.matching import normalize  # local import: matching imports this module

        accepted = {normalize(a) for a in (*self.answers, self.display_answer)}
        opts = [normalize(o) for o in self.options]
        if len(set(opts)) != 3:
            raise ValueError("options must be three different choices")
        if sum(o in accepted for o in opts) != 1:
            raise ValueError("exactly one option must be a correct answer")
        return self

    @model_validator(mode="after")
    def _numbers_are_numbers(self) -> Question:
        if self.kind == "number":
            for a in self.answers:
                if not re.fullmatch(r"-?\d+(\.\d+)?", a.replace(",", "")):
                    raise ValueError("number questions need numeric answers")
        return self


Line = Annotated[str, StringConstraints(min_length=3, max_length=220)]


class StoryEndings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    great: Line  # 80% or more correct
    good: Line  # 50% or more
    try_again: Line

    @field_validator("great", "good", "try_again", mode="before")
    @classmethod
    def _clean(cls, v: object) -> object:
        return clean_text(v) if isinstance(v, str) else v


class Story(BaseModel):
    """Optional quest told by the quiz wizard.

    Every right answer moves the quest on by one chapter; a wrong answer or timeout plays a
    setback line instead. The ending depends on the share of right answers. Every line is
    fixed text, so it is reviewed with the pack and pre-rendered like the questions: the
    story branches on answers without a live language model.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    wizard: Annotated[str, StringConstraints(min_length=2, max_length=30)]
    # Which wizard sprite set and scene the client shows (files in art/), and optionally a
    # different Timbre voice for this story, e.g. a male voice for an old wizard.
    wizard_sprite: Literal["sage", "sorceress", "owl"] = "sage"
    scene: Literal[
        "library-a",
        "library-b",
        "forest-temple",
        "sky-islands",
        "crystal-cave",
        "night-bazaar",
        "observatory",
    ] = "library-a"
    voice: Annotated[str, StringConstraints(pattern=r"^[A-Z][a-z]{2,15}$")] | None = None
    intro: Line
    chapters: list[Line] = Field(min_length=3, max_length=12)
    setbacks: list[Line] = Field(min_length=1, max_length=6)
    endings: StoryEndings

    @field_validator("wizard", "intro", mode="before")
    @classmethod
    def _clean(cls, v: object) -> object:
        return clean_text(v) if isinstance(v, str) else v

    @field_validator("chapters", "setbacks", mode="before")
    @classmethod
    def _clean_list(cls, v: object) -> object:
        if isinstance(v, list):
            return [clean_text(x) if isinstance(x, str) else x for x in v]
        return v

    def chapter(self, correct_so_far: int) -> str | None:
        """Line for the ``correct_so_far``-th right answer (1-based), if the quest has one."""
        i = correct_so_far - 1
        return self.chapters[i] if 0 <= i < len(self.chapters) else None

    def setback(self, misses_so_far: int) -> str:
        return self.setbacks[(misses_so_far - 1) % len(self.setbacks)]

    def ending(self, correct: int, questions: int) -> tuple[str, str]:
        ratio = correct / questions if questions else 0.0
        if ratio >= 0.8:
            return "great", self.endings.great
        if ratio >= 0.5:
            return "good", self.endings.good
        return "try_again", self.endings.try_again

    def all_lines(self) -> list[str]:
        e = self.endings
        return [self.intro, *self.chapters, *self.setbacks, e.great, e.good, e.try_again]


class Pack(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = Field(alias="schema", default=1)
    id: Slug
    title: Annotated[str, StringConstraints(min_length=3, max_length=60)]
    language: Literal["te-IN", "hi-IN", "hi-en", "en-IN", "te-en"]
    topic: Annotated[str, StringConstraints(min_length=2, max_length=40)]
    version: int = Field(ge=1)
    source: Literal["evon-v3.3", "hand"]
    reviewed_by: Annotated[str, StringConstraints(min_length=2, max_length=60)] | None = None
    reviewed_at: date | None = None
    questions: list[Question] = Field(min_length=5, max_length=50)
    story: Story | None = None

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

    @model_validator(mode="after")
    def _story_voice_fits_language(self) -> Pack:
        if self.story is None or self.story.voice is None:
            return self
        from app.game.languages import VOICES, route

        tts_lang = route(self.language).tts_lang
        if self.story.voice not in VOICES.get(tts_lang, frozenset()):
            raise ValueError(f"voice {self.story.voice!r} is not a Timbre {tts_lang} voice")
        return self

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
            # Enough for the quest list to show the scene and the wizard before a game starts.
            "story": (
                {
                    "wizard": self.story.wizard,
                    "wizard_sprite": self.story.wizard_sprite,
                    "scene": self.story.scene,
                    "chapters": len(self.story.chapters),
                }
                if self.story
                else None
            ),
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
