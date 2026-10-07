"""Answer matching — OWNED BY DEVESH (feature #21).

This is the reference implementation the server ships with and the contract the game engine
calls: ``match_answer(transcript, question) -> MatchResult``. It is deliberately strict
(normalised exact or whole-phrase containment, digit-aware for number questions). Fuzzy
matching, transliteration between Telugu/Devanagari/Latin and spoken-number handling are
Devesh's to extend; keep the signature and keep tests/test_matching.py passing.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.game.packs import Question

# Zero-width joiners matter for Indic rendering but not for identity.
_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿"), None)
# A transcript may add a few filler words ("the answer is ..."), but a list of guesses must not
# match: allow at most this many extra tokens beyond the accepted answer.
MAX_EXTRA_TOKENS = 4


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


def _numbers(text: str) -> list[str]:
    folded = unicodedata.normalize("NFKC", text)
    folded = "".join(
        str(unicodedata.digit(c)) if unicodedata.category(c) == "Nd" else c for c in folded
    )
    found = re.findall(r"-?\d[\d,]*(?:\.\d+)?", folded)
    return [_canon_number(n) for n in found]


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


def _contains_phrase(hay: list[str], needle: list[str]) -> bool:
    n = len(needle)
    return any(hay[i : i + n] == needle for i in range(len(hay) - n + 1))


def match_answer(
    transcript: str, question: Question, other_answers: frozenset[str] = frozenset()
) -> MatchResult:
    """``other_answers`` holds the normalised answers of the pack's *other* questions; naming
    one of them alongside the right answer counts as guessing a list, which is wrong."""
    norm = normalize(transcript)
    if not norm:
        return MatchResult(False, None, norm)
    tokens = norm.split()
    own = {normalize(a) for a in question.answers}
    for other in other_answers:
        if other and other not in own and _contains_phrase(tokens, other.split()):
            return MatchResult(False, None, norm)

    if question.kind == "number":
        spoken = _numbers(transcript)
        if len(spoken) > 1:  # saying more than one number is guessing
            return MatchResult(False, None, norm)
        for answer in question.answers:
            if _canon_number(answer) in spoken:
                return MatchResult(True, answer, norm)
        # fall through: some number answers are also accepted as words ("ten", "పది")

    for answer in question.answers:
        target = normalize(answer).split()
        if not target:
            continue
        if tokens == target:
            return MatchResult(True, answer, norm)
        if len(tokens) <= len(target) + MAX_EXTRA_TOKENS and _contains_phrase(tokens, target):
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
