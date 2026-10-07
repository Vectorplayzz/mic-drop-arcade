"""Fixed spoken lines (menus, feedback) per language, loaded from content/lines.json.

Templates may contain ``{answer}`` only. Because every value that fills a template comes from a
reviewed pack, every line the game can ever speak is known ahead of time and pre-rendered.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.game.languages import LANGUAGES

REQUIRED_KEYS = ("intro", "correct", "wrong", "timeout", "answer_was", "game_over", "retry")


class Lines:
    def __init__(self, data: dict[str, dict[str, str]]) -> None:
        for lang in LANGUAGES:
            missing = [k for k in REQUIRED_KEYS if not data.get(lang, {}).get(k)]
            if missing:
                raise ValueError(f"lines.json missing {missing} for {lang}")
            if "{answer}" not in data[lang]["answer_was"]:
                raise ValueError(f"answer_was for {lang} needs an {{answer}} placeholder")
        self._data = data

    @classmethod
    def load(cls, path: str | Path) -> Lines:
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def get(self, language: str, key: str, **values: str) -> str:
        template = self._data[language][key]
        return template.format(**values) if values else template

    def all_static(self, language: str) -> list[str]:
        return [v for k, v in self._data[language].items() if "{" not in v]
