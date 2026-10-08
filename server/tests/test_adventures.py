"""Adventure story graphs: schema, graph validation, choice matching, puzzle judging and the
shipped story files."""

from __future__ import annotations

import copy
import json
import re
import sys
import unicodedata
from pathlib import Path

import pytest

from app.game.adventures import (
    LANGS,
    Adventure,
    AdventureLibrary,
    match_choice,
    parse_adventure,
    spoken,
)
from app.game.languages import LANGUAGES, VOICE_CATALOG, WIZARD_VOICES, WIZARDS, route_for_wizard
from app.game.wizards import KEYS, WizardLines
from app.ws.adventure import adventure_max_score, puzzle_correct

SERVER_DIR = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "adventures"
SHIPPED = SERVER_DIR / "adventures"
sys.path.insert(0, str(SERVER_DIR / "scripts"))

import adventure_i18n  # noqa: E402


def _fixture() -> dict:
    return json.loads((FIXTURES / "test-quest.json").read_text(encoding="utf-8"))


def _all_story_files() -> list[Path]:
    return sorted(SHIPPED.glob("*.json")) + sorted((SHIPPED / "drafts").glob("*.json"))


# ---------------------------------------------------------------- schema + graph ---
def test_fixture_is_valid():
    adv = Adventure.model_validate(_fixture())
    assert adv.reviewed and adv.start == "a"
    assert {"lab-corridor", "lab-server", "lab-dawn", "fest-garden"} <= adv.scenes()


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda d: d["nodes"]["a"]["choices"][2].update(go="end:nowhere"), "unknown ending"),
        (lambda d: d["nodes"]["a"]["choices"][2].update(go="c"), "unknown node"),
        (lambda d: d["nodes"]["a"]["choices"][2].update(go="end:plain"), "unreachable endings"),
        (lambda d: d["nodes"]["b"]["puzzle"]["pass"].update(go="a"), "loop forever"),
        (lambda d: d["nodes"]["a"]["choices"][1].update(go="adventure:x-y-z"), "only the prologue"),
        (
            lambda d: [c.update({"if": {"has": ["nope"]}}) for c in d["nodes"]["a"]["choices"][1:]],
            "offers 1 choices",
        ),
        (lambda d: d["nodes"]["a"].update(scene="mars-base"), "unknown scene"),
        (lambda d: d["title"].pop("te-en"), "missing te-en"),
        (lambda d: d["title"].update({"fr-FR": "Quête"}), "unknown languages"),
        (lambda d: d["nodes"]["b"]["puzzle"]["options"]["hi-IN"].__setitem__(1, "8"), "different"),
        (
            lambda d: d["items"].update(ghost={"label": {lang: "Ghost" for lang in LANGS}}),
            "never gained",
        ),
        (lambda d: d["nodes"]["a"]["say"][0].update({"en-IN": "x" * 300}), "characters"),
    ],
)
def test_bad_graphs_are_rejected(mutate, message):
    data = _fixture()
    mutate(data)
    with pytest.raises(ValueError, match=message):
        Adventure.model_validate(data)


def test_too_long_runs_are_rejected():
    data = _fixture()
    # A chain of 15 two-way choices is longer than any adventure may be.
    for i in range(15):
        nid, nxt = f"c{i}", (f"c{i + 1}" if i < 14 else "a")
        data["nodes"][nid] = copy.deepcopy(data["nodes"]["a"])
        for c in data["nodes"][nid]["choices"]:
            c.pop("effects", None)
            c["go"] = nxt
    data["start"] = "c0"
    with pytest.raises(ValueError, match="longest run"):
        Adventure.model_validate(data)


def test_parse_rejects_oversized_files():
    with pytest.raises(ValueError, match="too large"):
        parse_adventure(b"{" + b" " * (600 * 1024) + b"}")


def test_library_skips_unreviewed_in_production(tmp_path):
    data = _fixture()
    data["reviewed_by"] = None
    (tmp_path / "test-quest.json").write_text(json.dumps(data), encoding="utf-8")
    assert AdventureLibrary.load(tmp_path, require_review=True).list() == []
    assert [a.id for a in AdventureLibrary.load(tmp_path, require_review=False).list()] == [
        "test-quest"
    ]


def test_prologue_with_missing_target_is_disabled(tmp_path):
    (tmp_path / "prologue.json").write_bytes((FIXTURES / "prologue.json").read_bytes())
    lib = AdventureLibrary.load(tmp_path, require_review=False)
    assert lib.prologue is None and lib.get("prologue") is None


def test_spoken_variant_is_read_but_not_shown():
    text = {"hi-en": "Kya baat hai", "hi-en@tts": "क्या बात है"}
    assert spoken(text, "hi-en") == "क्या बात है"
    assert spoken({"en-IN": "Hello"}, "en-IN") == "Hello"


# ---------------------------------------------------------------- choice matching --
CARDS = [
    ("Run to the engine", ["run", "engine", "front"]),
    ("Pull the emergency chain", ["chain", "emergency"]),
    ("Find the guard's van", ["guard", "van"]),
]


@pytest.mark.parametrize(
    ("heard", "index"),
    [
        ("two", 1),
        ("option three", 2),
        ("3", 2),
        ("पहला", 0),
        ("రెండు", 1),
        ("వన్", 0),  # "one" said in English, written in Telugu script by Prisma te-IN
        ("थ्री", 2),
        ("I'll run to the engine", 0),
        ("pull the chain now", 1),
        ("let's find the guard", 2),
    ],
)
def test_choices_are_heard(heard, index):
    assert match_choice(heard, CARDS) == index


TE_CARDS = [
    ("Direct ga lab ki", ["డైరెక్ట్", "ల్యాబ్", "lab"]),
    ("Iddariki chai theesukeltha", ["చాయ్", "టీ", "ఇద్దరికీ"]),
    ("Kiran ne fix chesukomanu", ["ఒంటరిగా", "నువ్వే"]),
]


@pytest.mark.parametrize(
    ("heard", "index"),
    [
        ("నేను ల్యాబ్ కి వెళ్తాను", 0),  # Prisma te-IN writes English loanwords in Telugu
        ("ఇద్దరికీ చాయ్ తీసుకెళ్తా", 1),
        ("direct ga lab ki", 0),  # the Latin card text itself, matched by sound
        ("రెండు", 1),
    ],
)
def test_tenglish_choices_are_heard_in_telugu_script(heard, index):
    assert match_choice(heard, TE_CARDS) == index


@pytest.mark.parametrize("heard", ["", "hmm", "engine or chain", "biryani", "four"])
def test_unclear_answers_pick_nothing(heard):
    assert match_choice(heard, CARDS) is None


def test_everyday_short_words_are_not_numbers():
    cards = [("Go to the lab", ["lab"]), ("Stay home", ["home"])]
    assert match_choice("to", cards) == 1
    assert match_choice("I want to go to the lab", cards) == 0


# ---------------------------------------------------------------- puzzles ---------
def test_puzzle_numbers_words_and_wrong_options():
    adv = Adventure.model_validate(_fixture())
    p = adv.nodes["b"].puzzle
    assert p is not None
    assert puzzle_correct(p, "en-IN", "eight")
    assert puzzle_correct(p, "en-IN", "it is 8")
    assert puzzle_correct(p, "hi-IN", "आठ")
    assert not puzzle_correct(p, "en-IN", "four")
    assert not puzzle_correct(p, "en-IN", "8 or 16")
    assert adventure_max_score(adv) >= 500


def test_text_puzzle_aliases():
    data = _fixture()
    pz = data["nodes"]["b"]["puzzle"]
    pz["kind"] = "text"
    pz["options"] = {lang: ["clockwise", "anticlockwise", "neither"] for lang in LANGS}
    pz["aliases"] = {"en-IN": ["clock wise"], "te-IN": ["క్లాక్‌వైజ్"]}
    p = Adventure.model_validate(data).nodes["b"].puzzle
    assert puzzle_correct(p, "en-IN", "clockwise of course")
    assert puzzle_correct(p, "en-IN", "clock wise")
    assert puzzle_correct(p, "te-IN", "క్లాక్‌వైజ్")
    assert not puzzle_correct(p, "en-IN", "anticlockwise")


# ---------------------------------------------------------------- shipped content --
def test_shipped_adventures_are_complete():
    files = _all_story_files()
    assert files, "no adventure files"
    ids = set()
    for path in files:
        adv = parse_adventure(path.read_bytes())
        ids.add(adv.id)
        for lang in LANGS:
            assert adv.all_lines(lang)
    lib = AdventureLibrary.load(SHIPPED / "drafts", require_review=False)
    assert lib.prologue is not None
    assert len(lib.list()) >= 8
    genres = {a.genre for a in lib.list()}
    assert {"action", "romance", "mystery", "scifi", "horror"} <= genres


_INDIC = re.compile(r"[ऀ-ॿఀ-౿]")


def _shown_texts(obj, lang):
    if isinstance(obj, dict):
        if lang in obj and isinstance(obj[lang], str):
            yield obj[lang]
        for k, v in obj.items():
            if k not in ("keywords", "aliases"):
                yield from _shown_texts(v, lang)
    elif isinstance(obj, list):
        for v in obj:
            yield from _shown_texts(v, lang)


@pytest.mark.parametrize("lang", ["hi-en", "te-en"])
def test_mixed_languages_are_shown_in_latin_script(lang):
    for path in _all_story_files():
        data = json.loads(path.read_text(encoding="utf-8"))
        for text in _shown_texts(data, lang):
            assert not _INDIC.search(text), (path.name, text)


def test_i18n_export_and_merge_round_trip():
    data = _fixture()
    table = adventure_i18n.export(data)
    assert table["nodes/a/choices/0/keywords"] == ["red"]
    table = {k: (v if isinstance(v, list) else v + "!") for k, v in table.items()}
    problems = adventure_i18n.merge(data, "hi-IN", table)
    assert problems == []
    assert data["title"]["hi-IN"] == "Test Quest!"
    assert adventure_i18n.check(data) == []
    bad = dict(table)
    bad.pop("title")
    assert adventure_i18n.merge(_fixture(), "hi-IN", bad) == ["missing title"]


# ---------------------------------------------------------------- wizards ----------
def test_every_wizard_has_a_voice_and_lines():
    lines = WizardLines.load(SERVER_DIR / "content" / "wizards.json")
    for lang in LANGUAGES:
        for wizard in WIZARDS:
            r = route_for_wizard(lang, wizard)
            assert r.voice in VOICE_CATALOG
            for key in KEYS:
                line = lines.get(lang, wizard, key)
                assert line.text and line.tts
                if lang in ("hi-en", "te-en"):
                    assert not _INDIC.search(line.text)
    # Every wizard has its own voice, except the two women sharing Poorvi in Telugu/Tenglish.
    for lang in LANGUAGES:
        shared = 1 if lang in ("te-IN", "te-en") else 0
        assert len(set(WIZARD_VOICES[lang].values())) == len(WIZARDS) - shared


def test_wizard_lines_must_be_complete(tmp_path):
    data = json.loads((SERVER_DIR / "content" / "wizards.json").read_text(encoding="utf-8"))
    del data["te-IN"]["owl"]["greet"]
    with pytest.raises(ValueError, match="te-IN/owl/greet"):
        WizardLines(data)


def test_no_control_characters_survive():
    data = _fixture()
    data["title"]["en-IN"] = "Test‮Quest"
    adv = Adventure.model_validate(data)
    assert all(unicodedata.category(c) != "Cf" for c in adv.title["en-IN"])
