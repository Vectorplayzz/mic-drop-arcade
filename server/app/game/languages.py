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


# Timbre v2.5 voices we use, with their home locale and gender (docs.gnani.ai voice catalogue,
# Oct 2026). Timbre has no male Telugu voice, so the male wizards speak Telugu with male voices
# from other locales; an Oct 8 audition (each wizard's greeting, transcribed back by Prisma)
# showed those as intelligible as the Telugu voices. Likewise Hinglish has a single voice
# (Poorvi), so the other wizards read the Devanagari-plus-English spoken text with Hindi voices.
VOICE_CATALOG: dict[str, tuple[str, str]] = {
    "Suhana": ("te-IN", "f"),
    "Lehara": ("te-IN", "f"),
    "Varuni": ("te-IN", "f"),
    "Nalini": ("hi-IN", "f"),
    "Chitra": ("hi-IN", "f"),
    "Roopesh": ("hi-IN", "m"),
    "Omkar": ("hi-IN", "m"),
    "Jalaj": ("hi-IN", "m"),
    "Poorvi": ("hi-en", "f"),
    "Kavin": ("kn-IN", "m"),
    "Kaveri": ("en-IN", "f"),
    "Trupti": ("en-IN", "f"),
    "Girish": ("en-IN", "m"),
    "Shlok": ("en-IN", "m"),
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
# Each character keeps one voice across languages where it can: the sage is a grounded elder
# (Roopesh), the trickster an expressive showman (Jalaj).
WIZARD_VOICES: dict[str, dict[str, str]] = {
    "te-IN": {
        "sorceress": "Suhana",
        "sage": "Roopesh",
        "owl": "Kavin",
        "enchantress": "Lehara",
        "trickster": "Jalaj",
    },
    "hi-IN": {
        "sorceress": "Nalini",
        "sage": "Roopesh",
        "owl": "Omkar",
        "enchantress": "Chitra",
        "trickster": "Jalaj",
    },
    "hi-en": {
        "sorceress": "Poorvi",
        "sage": "Roopesh",
        "owl": "Omkar",
        "enchantress": "Chitra",
        "trickster": "Jalaj",
    },
    "te-en": {
        "sorceress": "Varuni",
        "sage": "Roopesh",
        "owl": "Kavin",
        "enchantress": "Lehara",
        "trickster": "Jalaj",
    },
    "en-IN": {
        "sorceress": "Kaveri",
        "sage": "Girish",
        "owl": "Shlok",
        "enchantress": "Trupti",
        "trickster": "Jalaj",
    },
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
    voice = WIZARD_VOICES[base.code][wizard]
    return replace(
        base, voice=voice, speed=WIZARD_SPEED[wizard], tts_lang=tts_lang_for(base, voice)
    )


def tts_lang_for(base: LanguageRoute, voice: str) -> str:
    """The Timbre ``language`` for ``voice`` reading ``base``'s text.

    The text decides it (Timbre normalises by it), except that Hinglish's ``hi-en`` belongs to
    Poorvi alone: a Hindi voice reads the same Devanagari-plus-English text as ``hi-IN``."""
    if base.tts_lang == "hi-en" and voice != "Poorvi":
        return "hi-IN"
    return base.tts_lang


def route_for_pack(pack: Any) -> LanguageRoute:
    """The pack's language route, with the story's own voice if it sets one."""
    base = route(pack.language)
    story = getattr(pack, "story", None)
    if story is not None and story.voice:
        return replace(base, voice=story.voice)
    return base
