"""Spoken numbers in English (any script), Telugu and Hindi, mixed with digits."""

from __future__ import annotations

from app.game.matching import normalize

# value: spellings. English words appear as typed and as Prisma writes them in Telugu and
# Devanagari script; Telugu and Hindi number words are included for mixed answers.
_WORDS: dict[int, str] = {
    0: "zero ziro జీరో సున్నా शून्य ज़ीरो जीरो",
    1: "one won వన్ ఒకటి ఒక एक वन",
    2: "two టూ రెండు दो टू",
    3: "three త్రీ మూడు तीन थ्री",
    4: "four ఫోర్ ఫోర్ నాలుగు चार फ़ोर फोर",
    5: "five ఫైవ్ ఐదు అయిదు पाँच पांच फ़ाइव फाइव",
    6: "six సిక్స్ ఆరు छह छः सिक्स",
    7: "seven సెవెన్ ఏడు सात सेवन",
    8: "eight ఎయిట్ ఎనిమిది आठ एट एइट",
    9: "nine నైన్ తొమ్మిది नौ नाइन",
    10: "ten టెన్ పది दस टेन",
    11: "eleven ఎలెవెన్ ఇలెవెన్ పదకొండు ग्यारह इलेवन",
    12: "twelve ట్వెల్వ్ పన్నెండు बारह ट्वेल्व",
    13: "thirteen థర్టీన్ పదమూడు तेरह थर्टीन",
    14: "fourteen ఫోర్టీన్ పధ్నాలుగు పద్నాలుగు चौदह फ़ोर्टीन",
    15: "fifteen ఫిఫ్టీన్ పదిహేను पंद्रह फ़िफ़्टीन फिफ्टीन",
    16: "sixteen సిక్స్టీన్ పదహారు सोलह सिक्सटीन",
    17: "seventeen సెవెంటీన్ పదిహేడు सत्रह सेवनटीन",
    18: "eighteen ఎయిటీన్ పద్దెనిమిది अठारह एटीन",
    19: "nineteen నైంటీన్ పంతొమ్మిది उन्नीस नाइनटीन",
    20: "twenty ట్వంటీ ట్వెంటీ ఇరవై बीस ट्वेंटी",
    30: "thirty థర్టీ ముప్పై ముప్ఫై तीस थर्टी",
    40: "forty fourty ఫార్టీ ఫోర్టీ నలభై चालीस फ़ोर्टी फोर्टी",
    50: "fifty ఫిఫ్టీ యాభై पचास फ़िफ़्टी फिफ्टी",
    60: "sixty సిక్స్టీ అరవై साठ सिक्सटी",
    70: "seventy సెవెంటీ డెబ్బై सत्तर सेवंटी",
    80: "eighty ఎయిటీ ఎనభై अस्सी एटी",
    90: "ninety నైంటీ తొంభై नब्बे नाइंटी",
    100: "hundred హండ్రెడ్ వంద వందలు నూరు నూట सौ हंड्रेड",
    1000: "thousand థౌజండ్ థౌసండ్ వెయ్యి వేయి వేల हज़ार हजार थाउज़ेंड थाउजेंड",
}
_VALUE: dict[str, int] = {}
for _v, _spellings in _WORDS.items():
    for _w in _spellings.split():
        _VALUE[normalize(_w)] = _v
_SCALES = (100, 1000)


def _value(token: str) -> int | None:
    if token.isdigit() and len(token) <= 7:
        return int(token)
    return _VALUE.get(token)


def _standard(values: list[int]) -> int:
    """'three thousand 600' -> 3600; 'thirty six hundred' -> 3600."""
    total = current = 0
    for v in values:
        if v == 1000:
            total += (current or 1) * 1000
            current = 0
        elif v == 100:
            current = (current or 1) * 100
        else:
            current += v
    return total + current


def _paired(values: list[int]) -> int | None:
    """How people read numbers in pairs: 'ten twenty four' -> 1024, 'one forty four' -> 144,
    'four four three' -> 443. Only without hundred/thousand."""
    if any(v in _SCALES for v in values):
        return None
    parts: list[str] = []
    i = 0
    while i < len(values):
        v = values[i]
        if 20 <= v <= 90 and v % 10 == 0 and i + 1 < len(values) and 1 <= values[i + 1] <= 9:
            parts.append(str(v + values[i + 1]))
            i += 2
        else:
            parts.append(str(v))
            i += 1
    return int("".join(parts)) if len(parts) > 1 else None


def _indic(token: str) -> bool:
    return any("\u0900" <= c <= "\u097f" or "\u0c00" <= c <= "\u0c7f" for c in token)


def spoken_numbers(transcript: str) -> list[set[int]]:
    """Every number said, one set of readings per run of number words.

    A run that starts or ends on "hundred"/"thousand" next to a Hindi or Telugu word this
    table doesn't know ("एक हज़ार चौबीस": 24 isn't listed) is probably a longer number read
    only in part, so it is left out rather than misread."""
    tokens = normalize(transcript).split()
    values = [_value(t) for t in tokens]
    runs: list[list[int]] = []
    i = 0
    while i < len(tokens):
        if values[i] is None:
            i += 1
            continue
        j = i
        while j < len(tokens) and values[j] is not None:
            j += 1
        run = [v for v in values[i:j] if v is not None]
        cut_before = i > 0 and _indic(tokens[i - 1]) and run[0] in _SCALES
        cut_after = j < len(tokens) and _indic(tokens[j]) and run[-1] in _SCALES
        if not (cut_before or cut_after):
            runs.append(run)
        i = j
    out = []
    for run in runs:
        readings = {_standard(run)}
        if (p := _paired(run)) is not None:
            readings.add(p)
        out.append(readings)
    return out
