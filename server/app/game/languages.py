"""Language routing: which Prisma model and which Timbre voice each game language uses.

Hinglish has no STT code of its own; Prisma handles Hindi-English mixing under ``en-IN``.
It speaks its Devanagari-plus-English spoken text as ``hi-IN``.

Tenglish (Telugu-English mix) has neither. Live tests (Oct 7) showed Prisma ``te-IN`` hears
mixed speech well but writes English words in Telugu script ("ఆన్సర్ సెవెన్"), while ``en-IN``
garbles the Telugu, so Tenglish listens in ``te-IN`` and relies on the matcher's
transliteration. It speaks its Telugu-plus-English spoken text as ``te-IN``.

Voices are Timbre v3.0 (Oct 2026): 13 voices, each speaking every game language natively.
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
    "te-IN": LanguageRoute("te-IN", "తెలుగు", stt_lang="te-IN", tts_lang="te-IN", voice="Lakshmi"),
    "hi-IN": LanguageRoute("hi-IN", "हिन्दी", stt_lang="hi-IN", tts_lang="hi-IN", voice="Lakshmi"),
    "hi-en": LanguageRoute(
        "hi-en", "Hinglish", stt_lang="en-IN", tts_lang="hi-IN", voice="Lakshmi"
    ),
    "te-en": LanguageRoute(
        "te-en", "Tenglish", stt_lang="te-IN", tts_lang="te-IN", voice="Lakshmi"
    ),
    "en-IN": LanguageRoute("en-IN", "English", stt_lang="en-IN", tts_lang="en-IN", voice="Lakshmi"),
}


# Timbre v3.0 voices (docs.gnani.ai voice catalogue, Oct 2026) with their gender. Every voice
# speaks every game language, so any of them may narrate any language.
VOICE_CATALOG: dict[str, str] = {
    "Avinash": "m",
    "Chetana": "f",
    "Devansh": "m",
    "Harshad": "m",
    "Kalpana": "f",
    "Lakshmi": "f",
    "Prakash": "m",
    "Riyaa": "f",
    "Shivani": "f",
    "Shubham": "m",
    "Tarika": "f",
    "Vasudha": "f",
    "Yashraj": "m",
}
# Voices a story pack may pick, per Timbre language (every voice, in every language).
VOICES: dict[str, frozenset[str]] = {
    lang: frozenset(VOICE_CATALOG) for lang in ("te-IN", "hi-IN", "en-IN")
}

# The player picks the wizard who narrates (PROTOCOL §9); the wizard decides the voice and the
# personality of its reaction lines (content/wizards.json). The green sorceress is the default.
WIZARDS: tuple[str, ...] = ("sorceress", "sage", "owl", "enchantress", "trickster")
DEFAULT_WIZARD = "sorceress"
WIZARD_GENDER: dict[str, str] = {
    "sorceress": "f",
    "sage": "m",  # Baba Sage
    "owl": "m",  # Professor Ullu
    "enchantress": "f",  # Mohini
    "trickster": "m",  # Lomdi Jaadugar
}
# One voice per character in every language (Timbre v3.0 cast, Oct 19 audition).
_CAST = {
    "sorceress": "Lakshmi",  # expressive storyteller
    "sage": "Yashraj",  # warm narrator
    "owl": "Avinash",  # firm, deliberate: a professor
    "enchantress": "Riyaa",  # lively, confident
    "trickster": "Shubham",  # expressive, cocky
}
WIZARD_VOICES: dict[str, dict[str, str]] = {
    code: dict(_CAST) for code in ("te-IN", "hi-IN", "hi-en", "te-en", "en-IN")
}

WIZARD_SPEED: dict[str, float] = {
    "sorceress": 1.0,
    "sage": 0.92,
    "owl": 1.0,
    "enchantress": 0.96,
    "trickster": 1.08,
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
    return route_for_wizard(pack.language, wizard)


def route_for_wizard(language: str, wizard: str) -> LanguageRoute:
    """``language`` spoken in the picked wizard's voice and speed."""
    base = route(language)
    return replace(base, voice=WIZARD_VOICES[base.code][wizard], speed=WIZARD_SPEED[wizard])


def route_for_pack(pack: Any) -> LanguageRoute:
    """The pack's language route, with the story's own voice if it sets one."""
    base = route(pack.language)
    story = getattr(pack, "story", None)
    if story is not None and story.voice:
        return replace(base, voice=story.voice)
    return base
