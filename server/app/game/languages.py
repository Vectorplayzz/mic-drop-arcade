"""Language routing: which Prisma model and which Timbre voice each game language uses.

Hinglish has no STT code of its own; Prisma handles Hindi-English mixing under ``en-IN``.
Timbre has a dedicated Hinglish voice (Poorvi) under ``hi-en``.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class LanguageRoute:
    code: str
    label: str
    stt_lang: str
    tts_lang: str
    voice: str
    speed: float = 1.0


LANGUAGES: dict[str, LanguageRoute] = {
    "te-IN": LanguageRoute("te-IN", "తెలుగు", stt_lang="te-IN", tts_lang="te-IN", voice="Suhana"),
    "hi-IN": LanguageRoute("hi-IN", "हिन्दी", stt_lang="hi-IN", tts_lang="hi-IN", voice="Nalini"),
    "hi-en": LanguageRoute("hi-en", "Hinglish", stt_lang="en-IN", tts_lang="hi-en", voice="Poorvi"),
}


def route(code: str) -> LanguageRoute:
    try:
        return LANGUAGES[code]
    except KeyError as exc:
        raise ValueError(f"unsupported language {code!r}") from exc
