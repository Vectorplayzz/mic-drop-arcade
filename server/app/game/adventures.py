"""Branching voice adventures: schema, validation, loading and the choice matcher.

An adventure is a small story graph. Each node shows a painted scene and the wizard speaks
one to three lines. Then one of three things happens:

- the player picks one of two or three choices by saying it;
- the player answers a puzzle, where the right answer and a wrong one lead to different nodes;
- the story moves on by itself.

Choices and puzzles can change the adventure's meter (time, spark, clues, power or nerve) and
gain or lose flags. Later nodes branch on those flags and the meter, so earlier answers decide
which scenes, lines and endings a player meets. The design is branch-and-bottleneck with
state tracking: paths split and rejoin, and what was picked earlier still changes what happens.

Every line in every language is fixed text, reviewed with the file and pre-rendered like quiz
packs, so the story branches without a live language model. One file holds all five
languages, so a reviewer sees the translations side by side and the graph is identical in
every language.

``validate_graph`` walks every reachable state (node, flags, meter) before a file is accepted.
It proves the following:
- every node and ending can be reached;
- no path loops forever;
- every choice point offers the player two or three options;
- no run asks for more than ``MAX_INPUTS`` answers.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.game.matching import normalize, phonetic_key
from app.game.packs import clean_text
from app.logging import get_logger

log = get_logger(__name__)

ADVENTURE_SCHEMA_VERSION = 1
MAX_ADVENTURE_BYTES = 512 * 1024
LANGS: tuple[str, ...] = ("en-IN", "hi-IN", "hi-en", "te-IN", "te-en")
MAX_INPUTS = 14  # spoken answers in the longest run; keeps every adventure short
MAX_STATES = 20_000

# Painted scenes the client ships (client/src/assets/art/backgrounds/<id>.png).
SCENES: frozenset[str] = frozenset(
    {
        "library-a",
        "library-b",
        "forest-temple",
        "sky-islands",
        "crystal-cave",
        "night-bazaar",
        "observatory",
        "portals",
        *(
            f"train-{s}"
            for s in ("station coach roof bridge tunnel engine signal landslide river dawn".split())
        ),
        *(
            f"fest-{s}"
            for s in "gate lab arena stalls rooftop rain stage library garden dawn".split()
        ),
        *(
            f"lab-{s}"
            for s in (
                "corridor electronics server cctv canteen library office workshop rooftop dawn"
            ).split()
        ),
        *(
            f"orbit-{s}"
            for s in "deck alarm garden spacewalk core ai pods storm reentry ocean".split()
        ),
        *(
            f"hostel-{s}"
            for s in "outside corridor room stairs terrace mess basement warden well dawn".split()
        ),
        *(
            f"hampi-{s}"
            for s in "bazaar chariot river stepwell hall cave vault cliff gate camp".split()
        ),
        *(
            f"loop-{s}"
            for s in (
                "bedroom bus viva canteen xerox clocktower corridor ground rewind sunset"
            ).split()
        ),
        *(
            f"hack-{s}"
            for s in "hall stage netroom rooftop metro cafe alley datacenter van dawn".split()
        ),
    }
)

Genre = Literal[
    "prologue", "action", "romance", "mystery", "scifi", "horror", "fantasy", "comedy", "thriller"
]
GENRE_ORDER: tuple[str, ...] = (
    "action",
    "romance",
    "mystery",
    "scifi",
    "horror",
    "fantasy",
    "comedy",
    "thriller",
    "prologue",
)
Mood = Literal["ask", "happy", "sad", "cheer"]
Rank = Literal["gold", "silver", "bronze"]
Id = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,31}$")]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{2,47}$")]
Target = Annotated[
    str,
    StringConstraints(
        pattern=r"^([a-z][a-z0-9_]{0,31}|end:[a-z][a-z0-9_]{0,31}|adventure:[a-z][a-z0-9-]{2,47})$"
    ),
]


def _check_scene(value: str | None) -> str | None:
    if value is not None and value not in SCENES:
        raise ValueError(f"unknown scene {value!r}")
    return value


# Hinglish and Tenglish are shown in Latin script (as students type them), but Timbre reads
# the mixed-script version (Devanagari or Telugu plus English) far better. A text may carry
# that spoken version under "<lang>@tts"; without one, the shown text is also spoken.
TTS_VARIANTS: frozenset[str] = frozenset({"hi-en@tts", "te-en@tts"})


def spoken(text: dict[str, str], lang: str) -> str:
    """What Timbre should read for ``text`` in ``lang``."""
    return text.get(f"{lang}@tts") or text[lang]


def _localized(max_len: int, min_len: int = 1):
    """A text in every game language, cleaned like pack text."""

    def check(value: object) -> dict[str, str]:
        if not isinstance(value, dict):
            raise ValueError("expected an object keyed by language")
        extra = set(value) - set(LANGS) - TTS_VARIANTS
        if extra:
            raise ValueError(f"unknown languages {sorted(extra)}")
        out: dict[str, str] = {}
        for lang in (*LANGS, *sorted(TTS_VARIANTS & set(value))):
            raw = value.get(lang)
            if not isinstance(raw, str):
                raise ValueError(f"missing {lang} text")
            text = clean_text(raw)
            if not min_len <= len(text) <= max_len:
                raise ValueError(f"{lang} text must be {min_len}-{max_len} characters")
            out[lang] = text
        return out

    return check


def _localized_list(min_items: int, max_items: int, max_len: int):
    def check(value: object) -> dict[str, list[str]]:
        if not isinstance(value, dict):
            raise ValueError("expected an object keyed by language")
        extra = set(value) - set(LANGS)
        if extra:
            raise ValueError(f"unknown languages {sorted(extra)}")
        out: dict[str, list[str]] = {}
        for lang in LANGS:
            items = value.get(lang)
            if not isinstance(items, list) or not min_items <= len(items) <= max_items:
                raise ValueError(f"{lang} needs {min_items}-{max_items} entries")
            cleaned = []
            for item in items:
                if not isinstance(item, str):
                    raise ValueError(f"{lang} entries must be text")
                text = clean_text(item)
                if not 1 <= len(text) <= max_len or not normalize(text):
                    raise ValueError(f"{lang} entry {text!r} is empty or too long")
                cleaned.append(text)
            out[lang] = cleaned
        return out

    return check


Line = dict[str, str]  # one spoken line in every language (≤ 240 characters)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Effects(_Model):
    meter: int = Field(default=0, ge=-3, le=3)
    gain: list[Id] = Field(default_factory=list, max_length=4)
    lose: list[Id] = Field(default_factory=list, max_length=4)


class Cond(_Model):
    has: list[Id] = Field(default_factory=list, max_length=4)
    lacks: list[Id] = Field(default_factory=list, max_length=4)
    meter_at_least: int | None = None
    meter_below: int | None = None

    def holds(self, flags: frozenset[str], meter: int) -> bool:
        return (
            all(f in flags for f in self.has)
            and not any(f in flags for f in self.lacks)
            and (self.meter_at_least is None or meter >= self.meter_at_least)
            and (self.meter_below is None or meter < self.meter_below)
        )


class Branch(_Model):
    if_: Cond | None = Field(default=None, alias="if")
    go: Target


Route = Target | list[Branch]


def _route_ok(route: Route) -> Route:
    if isinstance(route, list):
        if not 1 <= len(route) <= 10:
            raise ValueError("a route needs 1-10 branches")
        if route[-1].if_ is not None:
            raise ValueError("the last branch of a route must have no condition")
        if any(b.if_ is None for b in route[:-1]):
            raise ValueError("only the last branch may be unconditional")
    return route


def resolve(route: Route, flags: frozenset[str], meter: int) -> str:
    if isinstance(route, str):
        return route
    for branch in route:
        if branch.if_ is None or branch.if_.holds(flags, meter):
            return branch.go
    raise AssertionError("validated routes always end unconditionally")


def _lines(value: object, *, min_items: int, max_items: int) -> list[Line]:
    if not isinstance(value, list) or not min_items <= len(value) <= max_items:
        raise ValueError(f"need {min_items}-{max_items} lines")
    check = _localized(240, 3)
    return [check(v) for v in value]


class Choice(_Model):
    label: Line
    keywords: dict[str, list[str]]
    if_: Cond | None = Field(default=None, alias="if")
    effects: Effects | None = None
    say: list[Line] = Field(default_factory=list)
    go: Route

    _label = field_validator("label", mode="before")(lambda v: _localized(40, 2)(v))
    _kw = field_validator("keywords", mode="before")(lambda v: _localized_list(1, 8, 30)(v))
    _say = field_validator("say", mode="before")(
        lambda v: _lines(v, min_items=0, max_items=2) if v is not None else []
    )
    _go = field_validator("go")(lambda v: _route_ok(v))


class Outcome(_Model):
    say: list[Line] = Field(default_factory=list)
    effects: Effects | None = None
    go: Route

    _say = field_validator("say", mode="before")(
        lambda v: _lines(v, min_items=0, max_items=2) if v is not None else []
    )
    _go = field_validator("go")(lambda v: _route_ok(v))


class Puzzle(_Model):
    prompt: Line
    kind: Literal["text", "number"] = "text"
    # Three on-screen options per language; ``answer`` is the index of the right one, the same
    # in every language. ``aliases`` adds other accepted ways to say the right answer.
    options: dict[str, list[str]]
    answer: int = Field(ge=0, le=2)
    aliases: dict[str, list[str]] = Field(default_factory=dict)
    pass_: Outcome = Field(alias="pass")
    fail: Outcome

    _prompt = field_validator("prompt", mode="before")(lambda v: _localized(240, 3)(v))
    _opts = field_validator("options", mode="before")(lambda v: _localized_list(3, 3, 40)(v))

    @field_validator("aliases", mode="before")
    @classmethod
    def _aliases(cls, v: object) -> object:
        if v is None or v == {}:
            return {lang: [] for lang in LANGS}
        if isinstance(v, dict):
            v = {lang: v.get(lang, []) for lang in LANGS}
            return _localized_list(0, 8, 40)(v)
        return v

    @model_validator(mode="after")
    def _distinct_options(self) -> Puzzle:
        for lang in LANGS:
            opts = [normalize(o) for o in self.options[lang]]
            if len(set(opts)) != 3:
                raise ValueError(f"{lang} options must be three different answers")
            if self.kind == "number":
                for o in self.options[lang]:
                    if not re.fullmatch(r"-?\d+(\.\d+)?", o.replace(",", "")):
                        raise ValueError("number puzzles need numeric options")
        return self

    def display_answer(self, lang: str) -> str:
        return self.options[lang][self.answer]

    def accepted(self, lang: str) -> list[str]:
        return [self.display_answer(lang), *self.aliases.get(lang, [])]

    def wrong_options(self, lang: str) -> list[str]:
        return [o for i, o in enumerate(self.options[lang]) if i != self.answer]


class Node(_Model):
    scene: str | None = None  # None keeps the previous scene
    mood: Mood = "ask"
    say: list[Line] = Field(default_factory=list)
    enter: Effects | None = None
    choices: list[Choice] | None = Field(default=None, min_length=2, max_length=4)
    puzzle: Puzzle | None = None
    go: Route | None = None

    _scene = field_validator("scene")(lambda v: _check_scene(v))
    _say = field_validator("say", mode="before")(
        lambda v: _lines(v, min_items=0, max_items=3) if v is not None else []
    )

    @field_validator("go")
    @classmethod
    def _go(cls, v: Route | None) -> Route | None:
        return _route_ok(v) if v is not None else v

    @model_validator(mode="after")
    def _one_exit(self) -> Node:
        exits = sum(x is not None for x in (self.choices, self.puzzle, self.go))
        if exits != 1:
            raise ValueError("a node needs exactly one of choices, puzzle or go")
        if self.go is None and not self.say and self.puzzle is None:
            raise ValueError("a choice node must say something first")
        if self.choices:
            for lang in LANGS:
                labels = [normalize(c.label[lang]) for c in self.choices]
                if len(set(labels)) != len(labels):
                    raise ValueError(f"{lang} choice labels must differ")
        return self


class Ending(_Model):
    title: Line
    rank: Rank
    scene: str | None = None
    mood: Mood = "happy"
    say: list[Line]

    _title = field_validator("title", mode="before")(lambda v: _localized(40, 2)(v))
    _scene = field_validator("scene")(lambda v: _check_scene(v))
    _say = field_validator("say", mode="before")(lambda v: _lines(v, min_items=1, max_items=3))


class Meter(_Model):
    label: Line
    icon: Literal["clock", "heart", "search", "bolt", "nerve", "flame", "star"]
    start: int = Field(ge=0, le=9)
    max: int = Field(ge=1, le=9)
    # Where the story goes the moment the meter falls to zero (e.g. out of time), if anywhere.
    on_zero: Target | None = None

    _label = field_validator("label", mode="before")(lambda v: _localized(20, 2)(v))

    @model_validator(mode="after")
    def _start_fits(self) -> Meter:
        if self.start > self.max:
            raise ValueError("meter start must not exceed max")
        return self


class Item(_Model):
    label: Line

    _label = field_validator("label", mode="before")(lambda v: _localized(30, 2)(v))


class Adventure(_Model):
    schema_version: Literal[1] = Field(alias="schema", default=1)
    id: Slug
    genre: Genre
    version: int = Field(ge=1)
    source: Literal["hand", "creator"]
    reviewed_by: Annotated[str, StringConstraints(min_length=2, max_length=60)] | None = None
    reviewed_at: date | None = None
    title: Line
    tagline: Line
    cover: str
    meter: Meter | None = None
    items: dict[Id, Item] = Field(default_factory=dict, max_length=12)
    start: Id
    nodes: dict[Id, Node] = Field(min_length=1, max_length=60)
    endings: dict[Id, Ending] = Field(default_factory=dict, max_length=8)

    _title = field_validator("title", mode="before")(lambda v: _localized(40, 3)(v))
    _tagline = field_validator("tagline", mode="before")(lambda v: _localized(120, 3)(v))
    _cover = field_validator("cover")(lambda v: _check_scene(v))

    @model_validator(mode="after")
    def _graph(self) -> Adventure:
        if self.genre == "prologue":
            if self.endings or self.meter:
                raise ValueError("the prologue routes to adventures; it has no endings or meter")
        elif len(self.endings) < 3:
            raise ValueError("an adventure needs at least three endings")
        validate_graph(self)
        return self

    @property
    def reviewed(self) -> bool:
        return bool(self.reviewed_by and self.reviewed_at)

    def node(self, node_id: str) -> Node:
        return self.nodes[node_id]

    def summary(self, lang: str) -> dict[str, object]:
        return {
            "id": self.id,
            "genre": self.genre,
            "title": self.title[lang],
            "tagline": self.tagline[lang],
            "cover": self.cover,
            "meter": self.meter_summary(lang),
            # Ending titles stay secret until a player reaches them; the client shows locks.
            "endings": [{"id": k, "rank": e.rank} for k, e in self.endings.items()],
            "scenes": sorted(self.scenes()),
        }

    def meter_summary(self, lang: str) -> dict[str, object] | None:
        if self.meter is None:
            return None
        return {"label": self.meter.label[lang], "icon": self.meter.icon, "max": self.meter.max}

    def scenes(self) -> set[str]:
        out = {self.cover}
        out |= {n.scene for n in self.nodes.values() if n.scene}
        out |= {e.scene for e in self.endings.values() if e.scene}
        return out

    def all_lines(self, lang: str) -> list[str]:
        """Every line the adventure can speak in ``lang``, as Timbre reads it (for
        pre-rendering audio)."""
        out: list[str] = []
        for node in self.nodes.values():
            out += [spoken(x, lang) for x in node.say]
            for c in node.choices or []:
                out += [spoken(x, lang) for x in c.say]
            if node.puzzle:
                p = node.puzzle
                out.append(spoken(p.prompt, lang))
                out += [spoken(x, lang) for x in (*p.pass_.say, *p.fail.say)]
        for e in self.endings.values():
            out += [spoken(x, lang) for x in e.say]
        return out


# ------------------------------------------------------------------ state machine ---
def apply(
    effects: Effects | None, flags: frozenset[str], meter: int, top: int
) -> tuple[frozenset[str], int]:
    if effects is None:
        return flags, meter
    flags = (flags | set(effects.gain)) - set(effects.lose)
    return frozenset(flags), max(0, min(top, meter + effects.meter))


def available(node: Node, flags: frozenset[str], meter: int) -> list[Choice]:
    return [c for c in node.choices or [] if c.if_ is None or c.if_.holds(flags, meter)]


def validate_graph(adv: Adventure) -> None:
    """Explore every reachable (node, flags, meter) state; raise ValueError on a bad graph."""
    nodes, endings = adv.nodes, adv.endings
    if adv.start not in nodes:
        raise ValueError(f"start node {adv.start!r} does not exist")

    def check_target(t: str, where: str) -> None:
        if t.startswith("end:"):
            if t[4:] not in endings:
                raise ValueError(f"{where}: unknown ending {t[4:]!r}")
        elif t.startswith("adventure:"):
            if adv.genre != "prologue":
                raise ValueError(f"{where}: only the prologue may jump to another adventure")
        elif t not in nodes:
            raise ValueError(f"{where}: unknown node {t!r}")

    def targets(route: Route) -> list[str]:
        return [route] if isinstance(route, str) else [b.go for b in route]

    for nid, node in nodes.items():
        for route in [node.go] if node.go is not None else []:
            for t in targets(route):
                check_target(t, nid)
        for c in node.choices or []:
            for t in targets(c.go):
                check_target(t, nid)
        if node.puzzle:
            for t in targets(node.puzzle.pass_.go) + targets(node.puzzle.fail.go):
                check_target(t, nid)
    if adv.meter and adv.meter.on_zero:
        check_target(adv.meter.on_zero, "meter.on_zero")

    top = adv.meter.max if adv.meter else 0
    start_meter = adv.meter.start if adv.meter else 0
    on_zero = adv.meter.on_zero if adv.meter else None
    seen_nodes: set[str] = set()
    seen_ends: set[str] = set()
    # memo: state -> most inputs still needed to finish from it
    done: dict[tuple[str, frozenset[str], int], int] = {}
    stack: set[tuple[str, frozenset[str], int]] = set()

    def step(target: str, flags: frozenset[str], meter: int, dropped: bool) -> int:
        if dropped and on_zero and meter == 0:
            target = on_zero
        if target.startswith("end:"):
            seen_ends.add(target[4:])
            return 0
        if target.startswith("adventure:"):
            return 0
        return visit(target, flags, meter)

    def after(effects: Effects | None, route: Route, flags: frozenset[str], meter: int) -> int:
        f2, m2 = apply(effects, flags, meter, top)
        return step(resolve(route, f2, m2), f2, m2, m2 < meter)

    def visit(nid: str, flags: frozenset[str], meter: int) -> int:
        key = (nid, flags, meter)
        if key in stack:
            raise ValueError(f"node {nid!r} can loop forever")
        if key in done:
            return done[key]
        if len(done) > MAX_STATES:
            raise ValueError("story graph has too many states")
        stack.add(key)
        seen_nodes.add(nid)
        node = nodes[nid]
        f, m = apply(node.enter, flags, meter, top)
        if node.enter is not None and m < meter and on_zero and m == 0:
            worst = step(on_zero, f, m, False)
        elif node.go is not None:
            worst = step(resolve(node.go, f, m), f, m, False)
        elif node.puzzle is not None:
            p = node.puzzle
            worst = 1 + max(
                after(p.pass_.effects, p.pass_.go, f, m), after(p.fail.effects, p.fail.go, f, m)
            )
        else:
            opts = available(node, f, m)
            if not 2 <= len(opts) <= 3:
                raise ValueError(
                    f"node {nid!r} offers {len(opts)} choices with flags {sorted(f)} and meter {m}"
                )
            worst = 1 + max(after(c.effects, c.go, f, m) for c in opts)
        stack.discard(key)
        done[key] = worst
        return worst

    longest = visit(adv.start, frozenset(), start_meter)
    if longest > MAX_INPUTS:
        raise ValueError(f"the longest run needs {longest} answers (max {MAX_INPUTS})")
    unreachable = set(nodes) - seen_nodes
    if unreachable:
        raise ValueError(f"unreachable nodes: {sorted(unreachable)}")
    never = set(endings) - seen_ends
    if never:
        raise ValueError(f"unreachable endings: {sorted(never)}")
    for item in adv.items:
        if not any(item in (e.gain if e else []) for e in _all_effects(adv)):
            raise ValueError(f"item {item!r} is never gained")


def _all_effects(adv: Adventure) -> list[Effects | None]:
    out: list[Effects | None] = []
    for n in adv.nodes.values():
        out.append(n.enter)
        out += [c.effects for c in n.choices or []]
        if n.puzzle:
            out += [n.puzzle.pass_.effects, n.puzzle.fail.effects]
    return out


# ------------------------------------------------------------------ choice matching --
# Players may say the number on a choice card instead of its words.
# English number words also come back from Prisma in Devanagari or Telugu script (वन, వన్),
# so those spellings count too.
_ORDINALS: dict[int, tuple[str, ...]] = {
    0: tuple(
        "1 one first won ek pehla pahla pehle एक पहला पहले वन फर्स्ट फ़र्स्ट "
        "okati okkati modati modatidi ఒకటి ఒక్కటి మొదటి మొదటిది వన్ ఫస్ట్".split()
    ),
    1: tuple(
        "2 two second to too do doosra dusra दो दूसरा टू सेकंड सेकेंड "
        "rendu rendo rendava రెండు రెండవ రెండోది రెండవది టూ సెకండ్".split()
    ),
    2: tuple(
        "3 three third teen tisra teesra तीन तीसरा थ्री थर्ड "
        "moodu mudu moodava మూడు మూడవ మూడోది మూడవది త్రీ థర్డ్".split()
    ),
}
_ORDINAL_KEYS: dict[str, int] = {
    normalize(word): idx for idx, words in _ORDINALS.items() for word in words
}
# "to"/"do"/"too" are everyday words; only count them when the whole answer is that word.
_WEAK_ORDINALS = frozenset({"to", "too", "do", "won"})


def _phonetic_tokens(text: str) -> list[str]:
    return [phonetic_key(t) for t in normalize(text).split() if t]


def _contains(hay: list[str], needle: list[str]) -> bool:
    n = len(needle)
    return n > 0 and any(hay[i : i + n] == needle for i in range(len(hay) - n + 1))


def match_choice(transcript: str, choices: list[tuple[str, list[str]]]) -> int | None:
    """Index of the choice the player said, or None when it is unclear.

    ``choices`` is ``[(label, keywords), ...]`` in the game language. A spoken number ("two",
    "రెండు") picks that card. Otherwise each choice scores one point per keyword or label
    heard (compared by sound, so English words in Telugu or Devanagari script still count),
    with a bonus for the whole label; the single best score wins and ties are unclear.
    """
    norm = normalize(transcript)
    if not norm:
        return None
    words = norm.split()
    if len(words) <= 3:
        picked = {
            _ORDINAL_KEYS[w]
            for w in words
            if w in _ORDINAL_KEYS and (w not in _WEAK_ORDINALS or len(words) == 1)
        }
        picked = {i for i in picked if i < len(choices)}
        if len(picked) == 1:
            return picked.pop()
    heard = _phonetic_tokens(transcript)
    scores: list[int] = []
    for label, keywords in choices:
        score = 0
        label_keys = _phonetic_tokens(label)
        if len(label_keys) > 1 and _contains(heard, label_keys):
            score += 3
        for phrase in {label, *keywords}:
            keys = _phonetic_tokens(phrase)
            if keys and _contains(heard, keys):
                score += len(keys)
        scores.append(score)
    best = max(scores, default=0)
    if best == 0 or scores.count(best) > 1:
        return None
    return scores.index(best)


# ------------------------------------------------------------------ loading ---------
def parse_adventure(raw: bytes | str) -> Adventure:
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if len(raw) > MAX_ADVENTURE_BYTES:
        raise ValueError("adventure too large")
    return Adventure.model_validate(json.loads(raw))


class AdventureLibrary:
    def __init__(self, adventures: dict[str, Adventure]) -> None:
        self._all = adventures
        self.prologue = adventures.get("prologue")
        if self.prologue is not None:
            missing = {
                t.split(":", 1)[1]
                for t in _prologue_targets(self.prologue)
                if t.split(":", 1)[1] not in adventures
            }
            if missing:
                log.error("prologue_targets_missing", missing=sorted(missing))
                self.prologue = None

    @classmethod
    def load(cls, directory: str | Path, *, require_review: bool = True) -> AdventureLibrary:
        found: dict[str, Adventure] = {}
        root = Path(directory)
        if root.is_dir():
            for path in sorted(root.glob("*.json")):  # drafts/ is never loaded
                try:
                    adv = parse_adventure(path.read_bytes())
                except (ValueError, OSError) as exc:
                    log.error("adventure_invalid", file=path.name, error=str(exc)[:300])
                    continue
                if require_review and not adv.reviewed:
                    log.warning("adventure_unreviewed_skipped", adventure=adv.id)
                    continue
                if adv.id in found:
                    log.error("adventure_duplicate_id", adventure=adv.id)
                    continue
                found[adv.id] = adv
        log.info("adventures_loaded", count=len(found))
        return cls(found)

    def get(self, adventure_id: str) -> Adventure | None:
        adv = self._all.get(adventure_id)
        return adv if adv is not None and adv.genre != "prologue" else None

    def list(self) -> list[Adventure]:
        """Adventures in showcase order (by genre), never the prologue."""
        return sorted(
            (a for a in self._all.values() if a.genre != "prologue"),
            key=lambda a: (GENRE_ORDER.index(a.genre), a.id),
        )

    def everything(self) -> list[Adventure]:
        return list(self._all.values())


def _prologue_targets(adv: Adventure) -> set[str]:
    out: set[str] = set()
    for n in adv.nodes.values():
        routes = [n.go] if n.go is not None else []
        routes += [c.go for c in n.choices or []]
        for r in routes:
            for t in [r] if isinstance(r, str) else [b.go for b in r]:
                if t.startswith("adventure:"):
                    out.add(t)
    return out
