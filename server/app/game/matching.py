"""Answer matching — OWNED BY DEVESH (feature #21).

The game engine calls ``match_answer(transcript, question, other_answers) -> MatchResult`` with
whatever Prisma heard. A transcript is accepted when it names one of the question's answers and
nothing that looks like a second guess. Matching runs in stages, strictest first:

1. **Exact:** normalised equality, or the answer as a whole phrase with a few extra words.
2. **Fillers:** the same test after dropping per-language filler words ("the answer is ...",
   "जवाब है ...", "సమాధానం ...").
3. **Sound:** tokens are compared by a phonetic key, so Telugu, Devanagari and Latin spellings
   of one word agree ("ఢిల్లీ" / "दिल्ली" / "delhi"), with one typo allowed in longer words.

Number questions compare values, and understand digits in any script as well as spoken numbers
in Telugu, Hindi and English ("ఏడు", "सात", "saat", "seven").

The stages only ever add ways to be right about *this* question's answers: naming another
question's answer from the same pack, or more than one number, is still a list of guesses.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

from app.game.packs import Question

# Zero-width joiners matter for Indic rendering but not for identity.
_ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff"), None)
# A transcript may add a few filler words ("the answer is ..."), but a list of guesses must not
# match: allow at most this many extra tokens beyond the accepted answer.
MAX_EXTRA_TOKENS = 4
# Once known fillers are removed, what is left over is more likely to be another guess.
MAX_EXTRA_AFTER_FILLERS = 2
# One typo is forgiven only in keys at least this long; short words must agree exactly.
FUZZY_MIN_KEY_LEN = 6


@dataclass(frozen=True, slots=True)
class MatchResult:
    correct: bool
    matched: str | None
    normalized: str


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_ZERO_WIDTH).casefold()
    out: list[str] = []
    for ch in text:
        cat = unicodedata.category(ch)
        if cat.startswith(("P", "S")):
            out.append(" ")
        elif cat == "Nd":
            out.append(str(unicodedata.digit(ch)))  # native digits -> ASCII
        else:
            out.append(ch)
    return " ".join("".join(out).split())


# ---------------------------------------------------------------- transliteration ----
# Devanagari (U+0900) and Telugu (U+0C00) share the ISCII layout, so one table indexed by the
# offset inside the block covers both scripts.
_DEVANAGARI = 0x0900
_TELUGU = 0x0C00

_INDEPENDENT_VOWELS = {
    0x05: "a", 0x06: "aa", 0x07: "i", 0x08: "ii", 0x09: "u", 0x0A: "uu", 0x0B: "ri",
    0x0C: "li", 0x0D: "e", 0x0E: "e", 0x0F: "e", 0x10: "ai", 0x11: "o", 0x12: "o",
    0x13: "o", 0x14: "au", 0x60: "ri",
}  # fmt: skip
_VOWEL_SIGNS = {
    0x3E: "aa", 0x3F: "i", 0x40: "ii", 0x41: "u", 0x42: "uu", 0x43: "ri", 0x44: "ri",
    0x45: "e", 0x46: "e", 0x47: "e", 0x48: "ai", 0x49: "o", 0x4A: "o", 0x4B: "o",
    0x4C: "au",
}  # fmt: skip
_CONSONANTS = {
    0x15: "k", 0x16: "kh", 0x17: "g", 0x18: "gh", 0x19: "n",
    0x1A: "ch", 0x1B: "chh", 0x1C: "j", 0x1D: "jh", 0x1E: "n",
    0x1F: "t", 0x20: "th", 0x21: "d", 0x22: "dh", 0x23: "n",
    0x24: "t", 0x25: "th", 0x26: "d", 0x27: "dh", 0x28: "n", 0x29: "n",
    0x2A: "p", 0x2B: "ph", 0x2C: "b", 0x2D: "bh", 0x2E: "m",
    0x2F: "y", 0x30: "r", 0x31: "r", 0x32: "l", 0x33: "l", 0x34: "l", 0x35: "v",
    0x36: "sh", 0x37: "sh", 0x38: "s", 0x39: "h",
}  # fmt: skip
_NASAL_SIGNS = {0x00, 0x01, 0x02, 0x04}  # candrabindu and anusvara forms
_VISARGA = 0x03
_VIRAMA = 0x4D

_VOWEL_LETTERS = frozenset("aeiou")


def _script(token: str) -> str:
    for ch in token:
        cp = ord(ch)
        if _DEVANAGARI <= cp < _DEVANAGARI + 0x80:
            return "deva"
        if _TELUGU <= cp < _TELUGU + 0x80:
            return "telu"
    return "latn" if any("a" <= ch <= "z" for ch in token) else "other"


def _romanize(token: str) -> str:
    """Rough Latin spelling of a Telugu or Devanagari token (other characters pass through)."""
    script = _script(token)
    base = _DEVANAGARI if script == "deva" else _TELUGU
    # Phones are (text, kind): C consonant, V written vowel, S inherent "a" (schwa).
    phones: list[tuple[str, str]] = []
    for ch in token:
        off = ord(ch) - base
        if not 0 <= off < 0x80:
            phones.append((ch, "V" if ch in _VOWEL_LETTERS else "C"))
        elif off in _CONSONANTS:
            phones.append((_CONSONANTS[off], "C"))
            phones.append(("a", "S"))
        elif off in _VOWEL_SIGNS:
            if phones and phones[-1][1] == "S":
                phones.pop()
            phones.append((_VOWEL_SIGNS[off], "V"))
        elif off in _INDEPENDENT_VOWELS:
            phones.append((_INDEPENDENT_VOWELS[off], "V"))
        elif off == _VIRAMA:
            if phones and phones[-1][1] == "S":
                phones.pop()
        elif off in _NASAL_SIGNS:
            phones.append(("n", "C"))
        elif off == _VISARGA:
            phones.append(("h", "C"))
        # nukta, length marks and anything else carry no sound we compare on
    if script == "deva":
        phones = _delete_schwas(phones)
    elif phones and phones[-1] == ("n", "C") and ord(token[-1]) - base in _NASAL_SIGNS:
        phones[-1] = ("m", "C")  # a word-final Telugu sunna is "m": పుస్తకం = pustakam
    return "".join(text for text, _ in phones)


def _delete_schwas(phones: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Hindi drops the inherent vowel at the end of a word and in VC_CV: लड़का is "ladka"."""

    def vowel(i: int) -> bool:
        return 0 <= i < len(phones) and phones[i][1] in "VS"

    if len(phones) > 2 and phones[-1][1] == "S":
        phones = phones[:-1]
    i = 1
    while i < len(phones) - 2:
        if (
            phones[i][1] == "S"
            and phones[i - 1][1] == "C"
            and vowel(i - 2)
            and phones[i + 1][1] == "C"
            and vowel(i + 2)
        ):
            del phones[i]
        else:
            i += 1
    return phones


_KEY_REWRITES = (
    ("chh", "ç"), ("ch", "ç"), ("ck", "k"), ("c", "k"), ("ç", "c"),
    ("q", "k"), ("x", "ks"), ("w", "v"), ("z", "j"), ("ph", "f"),
    ("sh", "s"), ("kh", "k"), ("gh", "g"), ("jh", "j"), ("th", "t"), ("dh", "d"), ("bh", "b"),
    ("aa", "a"), ("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u"),
)  # fmt: skip
_REPEATS = re.compile(r"(.)\1+")
_N_BEFORE_LABIAL = re.compile(r"n(?=[pbf])")
_Y_AS_VOWEL = re.compile(r"y(?![aeiou])")
_INNER_H = re.compile(r"(?<=.)h")


@lru_cache(maxsize=4096)
def phonetic_key(token: str) -> str:
    """Spelling-independent key: the same word in Telugu, Devanagari or Latin script, with
    long or short vowels and aspirated or plain consonants, maps to the same key."""
    if _script(token) in ("deva", "telu"):
        token = _romanize(token)
    for old, new in _KEY_REWRITES:
        token = token.replace(old, new)
    token = _N_BEFORE_LABIAL.sub("m", token)
    return _REPEATS.sub(r"\1", token)


@lru_cache(maxsize=4096)
def _loose_key(token: str) -> str:
    """Coarser key for comparing across scripts, where English spelling ("delhi") and a
    phonetic transliteration ("dilli") disagree on vowels and silent letters."""
    key = phonetic_key(token)
    key = _Y_AS_VOWEL.sub("i", key).replace("ai", "e").replace("au", "o")
    key = key.replace("e", "i").replace("o", "u").replace("iy", "i")
    key = _REPEATS.sub(r"\1", _INNER_H.sub("", key))
    if len(key) > 3 and key[-1] in "au":
        key = key[:-1]
    return key


def _edit_distance_at_most_one(a: str, b: str) -> bool:
    """True for one substitution, insertion, deletion or adjacent swap."""
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    i = 0
    while i < min(len(a), len(b)) and a[i] == b[i]:
        i += 1
    if len(a) == len(b):
        return a[i + 1 :] == b[i + 1 :] or (
            a[i : i + 2] == b[i : i + 2][::-1] and a[i + 2 :] == b[i + 2 :]
        )
    longer, shorter = (a, b) if len(a) > len(b) else (b, a)
    return longer[i + 1 :] == shorter[i:]


def _same_sound(a: str, b: str) -> bool:
    if a == b:
        return True
    if a.isdigit() or b.isdigit():
        return False
    ka, kb = phonetic_key(a), phonetic_key(b)
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    if _script(a) != _script(b):
        ka, kb = _loose_key(a), _loose_key(b)
        if ka == kb:
            return True
    return min(len(ka), len(kb)) >= FUZZY_MIN_KEY_LEN and _edit_distance_at_most_one(ka, kb)


def _same_key(a: str, b: str) -> bool:
    """Like ``_same_sound`` without the typo allowance: used to spot other answers."""
    if a == b:
        return True
    if a.isdigit() or b.isdigit() or not phonetic_key(a):
        return False
    if phonetic_key(a) == phonetic_key(b):
        return True
    return _script(a) != _script(b) and _loose_key(a) == _loose_key(b)


# ---------------------------------------------------------------- filler words -------
# Words a player wraps around the answer. Kept short on purpose: every entry is a word that
# may be ignored, so nothing that could plausibly *be* an answer belongs here.
_FILLERS_EN = frozenset(
    "a an the answer is it its s i think guess maybe um uh umm hmm ok okay well that this "
    "would be should my final probably like so yeah".split()
)
_FILLERS_HINGLISH = frozenset(
    "hai hain to toh shayad mujhe lagta hoga hogi mera jawab uttar ji haan yeh woh ye wo".split()
)
_FILLERS_HI = frozenset(
    "जवाब उत्तर है हैं होता होती होते होगा होगी वो वह यह ये तो मेरा मुझे लगता शायद जी "
    "अच्छा उम्म इसका उसका आंसर इज़ इज".split()
)
_FILLERS_TE = frozenset(
    "సమాధానం జవాబు అది ఇది అంటే అనుకుంటా అనుకుంటున్నాను నాకు తెలుసు అండి అండీ గారు ఏమో "
    "బహుశా అని కదా అంటారు దాని పేరు ఆన్సర్".split()
)
FILLERS: dict[str, frozenset[str]] = {
    "te-IN": _FILLERS_TE | _FILLERS_EN,
    "hi-IN": _FILLERS_HI | _FILLERS_EN,
    "hi-en": _FILLERS_HI | _FILLERS_HINGLISH | _FILLERS_EN,
}
_ALL_FILLERS = frozenset().union(*FILLERS.values())


def _fillers_for(language: str | None) -> frozenset[str]:
    return FILLERS.get(language or "", _ALL_FILLERS)


def _strip_fillers(tokens: list[str], fillers: frozenset[str]) -> list[str]:
    return [t for t in tokens if t not in fillers]


# ---------------------------------------------------------------- spoken numbers -----
_HINDI_0_TO_99 = (
    "शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह "
    "उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस "
    "तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चौवालीस "
    "पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन "
    "सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर "
    "इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी "
    "बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे "
    "चौरानवे पंचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे"
).split()
_HINDI_VARIANTS = {
    "जीरो": 0, "सिफर": 0, "छः": 6, "छे": 6, "छै": 6, "पन्द्रह": 15, "सत्तरह": 17,
    "अट्ठारह": 18, "उन्नीश": 19, "तेइस": 23, "चवालीस": 44, "तिरेपन": 53, "चौसठ": 64,
    "सरसठ": 67, "उनासी": 79, "नब्बै": 90, "निन्यानबे": 99,
    # English numbers as Prisma writes them inside Hindi and Hinglish speech
    "वन": 1, "टू": 2, "थ्री": 3, "फोर": 4, "फाइव": 5, "सिक्स": 6, "सेवन": 7, "एट": 8,
    "नाइन": 9, "टेन": 10,
}  # fmt: skip
_TELUGU_NUMBERS = {
    "సున్నా": 0, "సున్న": 0, "ఒకటి": 1, "రెండు": 2, "మూడు": 3, "నాలుగు": 4, "ఐదు": 5,
    "అయిదు": 5, "ఆరు": 6, "ఏడు": 7, "ఎనిమిది": 8, "తొమ్మిది": 9, "పది": 10,
    "పదకొండు": 11, "పన్నెండు": 12, "పదమూడు": 13, "పద్నాలుగు": 14, "పధ్నాలుగు": 14,
    "పదునాలుగు": 14, "పదిహేను": 15, "పదహారు": 16, "పదిహేడు": 17, "పద్దెనిమిది": 18,
    "పంతొమ్మిది": 19, "పందొమ్మిది": 19,
    "ఇరవై": 20, "ఇరవయ్": 20, "ముప్పై": 30, "ముప్పయ్": 30, "నలభై": 40, "నలభయ్": 40,
    "యాభై": 50, "యాభయ్": 50, "అరవై": 60, "అరవయ్": 60, "డెబ్బై": 70, "డెబ్బయ్": 70,
    "ఎనభై": 80, "ఎనభయ్": 80, "తొంభై": 90, "తొంభయ్": 90,
    "జీరో": 0, "వన్": 1, "టూ": 2, "త్రీ": 3, "ఫోర్": 4, "ఫైవ్": 5, "సిక్స్": 6,
    "సెవెన్": 7, "సెవన్": 7, "ఎయిట్": 8, "నైన్": 9, "టెన్": 10,
}  # fmt: skip
_ENGLISH_NUMBERS = {
    w: n
    for n, w in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
        "fifteen sixteen seventeen eighteen nineteen".split()
    )
} | {
    w: 10 * n
    for n, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split(), 2)
}
# Hindi and Telugu numbers typed in Latin letters, as Hinglish transcripts have them. Matched
# by exact spelling, never by sound: "at", "sat" and "tin" are English words.
_LATIN_NUMBERS = {
    "shunya": 0, "ek": 1, "do": 2, "teen": 3, "tin": 3, "char": 4, "chaar": 4, "paanch": 5,
    "panch": 5, "chhe": 6, "che": 6, "chhah": 6, "cheh": 6, "saat": 7, "sat": 7, "aath": 8,
    "aat": 8, "nau": 9, "das": 10, "dus": 10, "gyarah": 11, "gyaarah": 11, "barah": 12,
    "baarah": 12, "terah": 13, "chaudah": 14, "pandrah": 15, "solah": 16, "satrah": 17,
    "atharah": 18, "unnis": 19, "unnees": 19, "bees": 20, "bis": 20, "tees": 30, "chalis": 40,
    "chaalis": 40, "pachas": 50, "pachaas": 50, "saath": 60, "sattar": 70, "assi": 80,
    "nabbe": 90,
    "sunna": 0, "okati": 1, "rendu": 2, "moodu": 3, "mudu": 3, "nalugu": 4, "naalugu": 4,
    "aidu": 5, "aaru": 6, "aru": 6, "edu": 7, "yedu": 7, "enimidi": 8, "tommidi": 9,
    "thommidi": 9, "padi": 10,
}  # fmt: skip
# Latin spellings that are also everyday English words. They count as numbers only when they
# stand alone or sit inside a longer number ("do sau").
_AMBIGUOUS_LATIN = frozenset({"one", "do", "teen", "tin", "char", "sat", "che", "edu", "das"})

_HUNDREDS = {"सौ", "सो", "వంద", "వందలు", "వందల", "నూరు", "నూట", "hundred", "sau", "vanda"}
_MULTIPLIERS = {
    "हजार": 1_000, "हज़ार": 1_000, "లక్ష": 100_000, "వెయ్యి": 1_000, "వేయి": 1_000,
    "వేలు": 1_000, "వేల": 1_000, "thousand": 1_000, "hazar": 1_000, "hazaar": 1_000,
    "hajar": 1_000, "veyyi": 1_000, "लाख": 100_000, "లక్షలు": 100_000, "లక్షల": 100_000,
    "lakh": 100_000, "lac": 100_000, "lakhs": 100_000, "million": 1_000_000,
    "करोड़": 10_000_000, "కోటి": 10_000_000, "కోట్లు": 10_000_000, "కోట్ల": 10_000_000,
    "crore": 10_000_000, "crores": 10_000_000,
}  # fmt: skip
_POINT_WORDS = {"point", "दशमलव", "पॉइंट", "पाइंट", "पॉइन्ट", "పాయింట్"}


_LONG_VOWELS = (("aa", "a"), ("ii", "i"), ("uu", "u"))


@lru_cache(maxsize=4096)
def _number_key(token: str) -> str:
    """Finer than ``phonetic_key``: सात (7) and साठ (60) differ only in aspiration."""
    token = _romanize(token)
    for old, new in _LONG_VOWELS:
        token = token.replace(old, new)
    return _REPEATS.sub(r"\1", token)


def _keyed(words: dict[str, int]) -> dict[str, int]:
    return {_number_key(normalize(w)): n for w, n in words.items()}


# Indic-script number words are looked up by key, so vowel-length and nasal spelling
# variants ("पांच" / "पाँच") need no entries of their own.
_UNITS_BY_SCRIPT: dict[str, dict[str, int]] = {
    "deva": _keyed(dict(zip(_HINDI_0_TO_99, range(100), strict=True)) | _HINDI_VARIANTS),
    "telu": _keyed(_TELUGU_NUMBERS),
}
_HUNDRED_KEYS = {_number_key(normalize(w)) for w in _HUNDREDS if _script(w) != "latn"}
_MULTIPLIER_KEYS = {
    _number_key(normalize(w)): n for w, n in _MULTIPLIERS.items() if _script(w) != "latn"
}
_POINT_KEYS = {_number_key(normalize(w)) for w in _POINT_WORDS}
_TELUGU_TENS = {k: v for k, v in _UNITS_BY_SCRIPT["telu"].items() if v >= 20}


def _number_word(token: str) -> tuple[str, int] | None:
    """Classify a token as ("unit", 0-99), ("hundred", 100) or ("mult", n); None otherwise."""
    script = _script(token)
    if script == "latn":
        if token in _ENGLISH_NUMBERS:
            return "unit", _ENGLISH_NUMBERS[token]
        if token in _LATIN_NUMBERS:
            return "unit", _LATIN_NUMBERS[token]
        if token in _HUNDREDS:
            return "hundred", 100
        if token in _MULTIPLIERS:
            return "mult", _MULTIPLIERS[token]
        return None
    units = _UNITS_BY_SCRIPT.get(script)
    if units is None:
        return None
    key = _number_key(token)
    if key in units:
        return "unit", units[key]
    if key in _HUNDRED_KEYS:
        return "hundred", 100
    if key in _MULTIPLIER_KEYS:
        return "mult", _MULTIPLIER_KEYS[key]
    if script == "telu":  # tens and units written as one word: ఇరవైఒకటి, ఇరవయ్యొకటి
        for tens_key, tens in _TELUGU_TENS.items():
            rest = units.get(key[len(tens_key) :]) if key.startswith(tens_key) else None
            if rest is not None and 1 <= rest <= 9:
                return "unit", tens + rest
    return None


def _word_numbers(tokens: list[str], fillers: frozenset[str]) -> list[str]:
    """Values of the spoken numbers in ``tokens``; consecutive number words that cannot form
    one number ("one two three") come back as separate values."""
    found: list[str] = []
    content = _strip_fillers(tokens, fillers)
    i = 0
    while i < len(tokens):
        if _number_word(tokens[i]) is None:
            i += 1
            continue
        start, total, current, last = i, 0, 0, ""
        while i < len(tokens):
            word_text = tokens[i]
            word = _number_word(word_text)
            if word is None:
                more = i + 1 < len(tokens) and _number_word(tokens[i + 1]) is not None
                if word_text == "and" and last in ("hundred", "mult") and more:
                    i += 1
                    continue
                break
            kind, value = word
            if kind == "unit":
                fits = not last or last in ("hundred", "mult")
                fits = fits or (
                    last == "unit" and current % 100 in range(20, 100, 10) and value < 10
                )
                if not fits:
                    break
                current += value
            elif kind == "hundred":
                if last == "unit" and 1 <= current <= 99:
                    current *= 100
                elif not last or last == "mult":
                    current += 100
                else:
                    break
            else:
                if last == "mult":
                    break
                total += max(current, 1) * value
                current = 0
            last = kind
            i += 1
        run = tokens[start:i]
        if len(run) == 1 and run[0] in _AMBIGUOUS_LATIN and content != run:
            continue
        number = str(total + current)
        if i + 1 < len(tokens) and _number_key(tokens[i]) in _POINT_KEYS:
            digits, j = [], i + 1
            while j < len(tokens):
                word = _number_word(tokens[j])
                if word is None or word[0] != "unit" or word[1] > 9:
                    break
                digits.append(str(word[1]))
                j += 1
            if digits:
                number, i = _canon_number(f"{number}.{''.join(digits)}"), j
        found.append(number)
    return found


def _numbers(text: str, fillers: frozenset[str] = _ALL_FILLERS) -> list[str]:
    folded = unicodedata.normalize("NFKC", text)
    folded = "".join(
        str(unicodedata.digit(c)) if unicodedata.category(c) == "Nd" else c for c in folded
    )
    found = re.findall(r"-?\d[\d,]*(?:\.\d+)?", folded)
    return [_canon_number(n) for n in found] + _word_numbers(normalize(text).split(), fillers)


def _canon_number(n: str) -> str:
    n = n.replace(",", "")
    sign = ""
    if n.startswith("-"):
        sign, n = "-", n[1:]
    if "." in n:
        n = n.rstrip("0").rstrip(".")
    n = n.lstrip("0")
    if not n or n.startswith("."):
        n = "0" + n
    return "0" if n == "0" else sign + n


# ---------------------------------------------------------------- matching -----------
def _contains_phrase(hay: list[str], needle: list[str], same=str.__eq__) -> bool:
    n = len(needle)
    return any(
        all(same(h, t) for h, t in zip(hay[i : i + n], needle, strict=True))
        for i in range(len(hay) - n + 1)
    )


def _names(tokens: list[str], target: list[str], max_extra: int, same=str.__eq__) -> bool:
    return len(tokens) <= len(target) + max_extra and _contains_phrase(tokens, target, same)


def match_answer(
    transcript: str,
    question: Question,
    other_answers: frozenset[str] = frozenset(),
    *,
    language: str | None = None,
) -> MatchResult:
    """``other_answers`` holds the normalised answers of the pack's *other* questions; naming
    one of them alongside the right answer counts as guessing a list, which is wrong.

    ``language`` (a pack language code) narrows the filler-word list; without it the fillers
    of every language apply."""
    norm = normalize(transcript)
    if not norm:
        return MatchResult(False, None, norm)
    tokens = norm.split()
    own = {normalize(a) for a in question.answers}
    others = [o.split() for o in other_answers if o and o not in own]
    if any(_contains_phrase(tokens, other) for other in others):
        return MatchResult(False, None, norm)
    fillers = _fillers_for(language)

    if question.kind == "number":
        accepted = {_canon_number(a) for a in question.answers}
        # Numbers repeated from the question ("एक हफ़्ते में सात दिन") are not guesses.
        asked = set(_numbers(question.prompt, fillers)) - accepted
        spoken = {n for n in _numbers(transcript, fillers) if n not in asked}
        if len(spoken) > 1:  # saying more than one number is guessing
            return MatchResult(False, None, norm)
        for answer in question.answers:
            if _canon_number(answer) in spoken:
                return MatchResult(True, answer, norm)
        # fall through: some number answers are also accepted as words ("ten", "పది")

    content = _strip_fillers(tokens, fillers)
    views = [(tokens, MAX_EXTRA_TOKENS)]
    if content and content != tokens:
        views.append((content, MAX_EXTRA_AFTER_FILLERS))
    targets: list[tuple[str, list[str]]] = []
    for answer in question.answers:
        target = normalize(answer).split()
        if target:
            targets.append((answer, target))
            stripped = _strip_fillers(target, fillers)
            if stripped and stripped != target:
                targets.append((answer, stripped))

    for answer, target in targets:
        if any(_names(view, target, extra) for view, extra in views):
            return MatchResult(True, answer, norm)

    # From here on spellings only have to sound alike, so another question's answer written
    # in a different script counts as a second guess too.
    if any(_contains_phrase(tokens, other, _same_key) for other in others):
        return MatchResult(False, None, norm)
    spoken_key = "".join(phonetic_key(t) for t in content or tokens)
    for answer, target in targets:
        if any(_names(view, target, extra, _same_sound) for view, extra in views):
            return MatchResult(True, answer, norm)
        # Word breaks differ between speakers and STT runs: "newdelhi" is "new delhi".
        if len(spoken_key) >= 4 and spoken_key == "".join(phonetic_key(t) for t in target):
            return MatchResult(True, answer, norm)
    return MatchResult(False, None, norm)


def pack_answer_index(questions: list[Question]) -> dict[str, frozenset[str]]:
    """For each question id, the normalised answers of every other question in the pack."""
    norm = {q.id: frozenset(normalize(a) for a in q.answers) for q in questions}
    everything = frozenset().union(*norm.values()) if norm else frozenset()
    return {qid: everything - mine for qid, mine in norm.items()}


def looks_like_echo(transcript: str, prompt: str) -> bool:
    """True when the 'answer' is mostly the question itself — speaker echo leaking into the mic."""
    t = set(normalize(transcript).split())
    p = set(normalize(prompt).split())
    if len(t) < 4 or not p:
        return False
    return len(t & p) / len(t) >= 0.6
