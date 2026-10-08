"""The narrator wizards' own reaction lines, one personality each (content/wizards.json).

The story text is shared; these short lines are what make the sorceress warm, the sage wise,
the owl nerdy, the enchantress flirty and the trickster sly. Like every other line they are
fixed, reviewed text, so they are pre-rendered and never generated live.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.game.languages import LANGUAGES, WIZARDS

KEYS = (
    "greet",
    "choose_again",
    "chose_for_you",
    "puzzle_right",
    "puzzle_wrong",
    "ending_good",
    "ending_bad",
)
MAX_LEN = 220


@dataclass(frozen=True, slots=True)
class WizardLine:
    text: str  # shown on screen
    tts: str  # read by Timbre (differs for Latin-script Hinglish and Tenglish)


class WizardLines:
    def __init__(self, data: dict[str, dict[str, dict[str, dict[str, str]]]]) -> None:
        lines: dict[tuple[str, str, str], WizardLine] = {}
        for lang in LANGUAGES:
            for wizard in WIZARDS:
                for key in KEYS:
                    raw = data.get(lang, {}).get(wizard, {}).get(key)
                    if not isinstance(raw, dict) or not isinstance(raw.get("text"), str):
                        raise ValueError(f"wizards.json is missing {lang}/{wizard}/{key}")
                    text = " ".join(raw["text"].split())
                    tts = " ".join(str(raw.get("tts") or text).split())
                    if not (3 <= len(text) <= MAX_LEN and 3 <= len(tts) <= MAX_LEN):
                        raise ValueError(f"wizards.json {lang}/{wizard}/{key} has a bad length")
                    lines[(lang, wizard, key)] = WizardLine(text, tts)
        self._lines = lines

    @classmethod
    def load(cls, path: str | Path) -> WizardLines:
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def get(self, language: str, wizard: str, key: str) -> WizardLine:
        return self._lines[(language, wizard, key)]

    def all_tts(self, language: str, wizard: str) -> list[str]:
        return [self._lines[(language, wizard, k)].tts for k in KEYS]
