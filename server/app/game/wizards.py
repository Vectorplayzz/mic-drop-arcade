"""The narrator wizards' own reaction lines, one personality each (content/wizards.json).

The story text is shared; these short lines are what make the sorceress warm, the sage wise,
the owl nerdy, the enchantress flirty and the trickster sly. Like every other line they are
fixed, reviewed text, so they are pre-rendered and never generated live.

Timbre v3.0 reads inline audio tags (<laugh>, <sigh>, ...). Each wizard's reactions carry the
tag that suits its personality (WIZARD_TAGS); tags go only into the spoken text, never into
the caption.
"""

from __future__ import annotations

import json
import re
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

# Timbre v3.0's audio tags (docs.gnani.ai, Oct 2026). Any other <...> would be read aloud.
AUDIO_TAGS = frozenset(
    {
        "<coughs>",
        "<excited>",
        "<exhales>",
        "<giggle>",
        "<laugh>",
        "<pauses>",
        "<shouting>",
        "<sigh>",
        "<slow>",
        "<sniffles>",
        "<whispers>",
        "<yawns>",
        "<clears throat>",
    }
)
_TAG = re.compile(r"<[^<>]{1,24}>")

# How each wizard delivers each reaction: the sorceress warmly, the sage like an old teacher,
# the owl like a fussy professor, the enchantress teasing, the trickster laughing at you.
WIZARD_TAGS: dict[str, dict[str, str]] = {
    "sorceress": {
        "greet": "<excited>",
        "puzzle_right": "<excited>",
        "puzzle_wrong": "<sigh>",
        "ending_good": "<excited>",
        "ending_bad": "<sigh>",
    },
    "sage": {
        "greet": "<clears throat>",
        "chose_for_you": "<exhales>",
        "puzzle_right": "<pauses>",
        "puzzle_wrong": "<sigh>",
        "ending_good": "<laugh>",
        "ending_bad": "<sigh>",
    },
    "owl": {
        "greet": "<clears throat>",
        "choose_again": "<clears throat>",
        "puzzle_right": "<excited>",
        "puzzle_wrong": "<clears throat>",
        "ending_good": "<laugh>",
        "ending_bad": "<sigh>",
    },
    "enchantress": {
        "greet": "<giggle>",
        "choose_again": "<whispers>",
        "puzzle_right": "<giggle>",
        "puzzle_wrong": "<sigh>",
        "ending_good": "<giggle>",
        "ending_bad": "<sigh>",
    },
    "trickster": {
        "greet": "<laugh>",
        "chose_for_you": "<laugh>",
        "puzzle_right": "<laugh>",
        "puzzle_wrong": "<laugh>",
        "ending_good": "<laugh>",
        "ending_bad": "<laugh>",
    },
}


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
                    if _TAG.search(text):
                        raise ValueError(f"wizards.json {lang}/{wizard}/{key}: tags in shown text")
                    tts = " ".join(str(raw.get("tts") or text).split())
                    tag = WIZARD_TAGS.get(wizard, {}).get(key)
                    if tag and not _TAG.search(tts):
                        tts = f"{tag} {tts}"
                    unknown = set(_TAG.findall(tts)) - AUDIO_TAGS
                    if unknown:
                        raise ValueError(f"wizards.json {lang}/{wizard}/{key}: unknown {unknown}")
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
