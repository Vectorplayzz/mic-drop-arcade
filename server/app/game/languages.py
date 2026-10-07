"""Language routing: which Prisma model and which Timbre voice each game language uses.

Hinglish has no STT code of its own; Prisma handles Hindi-English mixing under ``en-IN``.
Timbre has a dedicated Hinglish voice (Poorvi) under ``hi-en``.

Tenglish (Telugu-English mix) has neither. Live tests (Oct 7) showed Prisma ``te-IN`` hears
mixed speech well but writes English words in Telugu script ("ఆన్సర్ సెవెన్"), while ``en-IN``
garbles the Telugu, so Tenglish listens in ``te-IN`` and relies on the matcher's
transliteration. It speaks with a Telugu voice reading mixed-script text.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any


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
    "te-en": LanguageRoute("te-en", "Tenglish", stt_lang="te-IN", tts_lang="te-IN", voice="Varuni"),
    "en-IN": LanguageRoute("en-IN", "English", stt_lang="en-IN", tts_lang="en-IN", voice="Girish"),
}


# Timbre v2.5 voices per `language` value (docs.gnani.ai voice catalogue, Oct 2026). A story may
# pick any voice listed for its language's TTS locale, e.g. a male storyteller for an old wizard.
VOICES: dict[str, frozenset[str]] = {
    "te-IN": frozenset({"Suhana", "Lehara", "Lavanya", "Yukti", "Varuni"}),
    "hi-IN": frozenset(
        {
            "Nalini",
            "Bhavna",
            "Yashvi",
            "Urmila",
            "Jwala",
            "Chitra",
            "Ambuja",
            "Deepak",
            "Roopesh",
            "Vikrant",
            "Hemraj",
            "Jalaj",
            "Omkar",
        }
    ),
    "hi-en": frozenset({"Poorvi"}),
    "en-IN": frozenset({"Kaveri", "Trupti", "Devika", "Pranav", "Shlok", "Girish"}),
}


# The player picks the wizard who narrates (PROTOCOL §9); the wizard decides the voice. The green
# sorceress is the default. Hinglish has a single Timbre voice, so every wizard shares it there.
WIZARDS: tuple[str, ...] = ("sorceress", "sage", "owl")
DEFAULT_WIZARD = "sorceress"
WIZARD_VOICES: dict[str, dict[str, str]] = {
    "te-IN": {"sorceress": "Suhana", "sage": "Lavanya", "owl": "Yukti"},
    "hi-IN": {"sorceress": "Nalini", "sage": "Jalaj", "owl": "Omkar"},
    "hi-en": {"sorceress": "Poorvi", "sage": "Poorvi", "owl": "Poorvi"},
    "te-en": {"sorceress": "Varuni", "sage": "Lavanya", "owl": "Yukti"},
    "en-IN": {"sorceress": "Kaveri", "sage": "Girish", "owl": "Shlok"},
}


def valid_wizard(value: object) -> str | None:
    """The wizard id if it is one we ship; None for anything else."""
    return value if isinstance(value, str) and value in WIZARDS else None


def route(code: str) -> LanguageRoute:
    try:
        return LANGUAGES[code]
    except KeyError as exc:
        raise ValueError(f"unsupported language {code!r}") from exc


def route_for_game(pack: Any, wizard: str) -> LanguageRoute:
    """The route a game speaks with: the pack's language in the picked wizard's voice."""
    base = route(pack.language)
    return replace(base, voice=WIZARD_VOICES[base.code][wizard])


def route_for_pack(pack: Any) -> LanguageRoute:
    """The pack's language route, with the story's own voice if it sets one."""
    base = route(pack.language)
    story = getattr(pack, "story", None)
    if story is not None and story.voice:
        return replace(base, voice=story.voice)
    return base
