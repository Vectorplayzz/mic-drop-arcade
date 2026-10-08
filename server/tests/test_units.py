"""Unit tests for the security, voice and game building blocks."""

from __future__ import annotations

import asyncio
import time

import fakeredis
import jwt
import pytest

from app.budget import CreditBudget
from app.config import Settings
from app.db import NicknameError, validate_nickname
from app.game import scoring
from app.game.lines import Lines
from app.game.matching import looks_like_echo, match_answer, normalize
from app.game.packs import PackLibrary, Question, parse_pack
from app.gnani.errors import GnaniAuthError, GnaniError
from app.gnani.stt import FRAME_BYTES, PcmFramer, SttStream
from app.gnani.tts import TtsStreamer
from app.security.client_ip import hash_ip
from app.security.http import origin_allowed
from app.security.ratelimit import RateLimiter
from app.security.tokens import ScoreClaims, TokenError, TokenService
from app.voice.cache import AudioCache, cache_key
from app.voice.vad import BargeInDetector, rms_dbfs
from tests.conftest import FIXTURES, SERVER_DIR
from tests.mock_gnani import API_KEY, silence, tone

SECRET = "x" * 40


# ---------------------------------------------------------------- tokens -----------
def test_session_token_roundtrip_and_audience_separation():
    svc = TokenService(SECRET, 60, 60)
    token, claims = svc.issue_session("iphash")
    assert svc.verify_session(token).session_id == claims.session_id
    with pytest.raises(TokenError):
        svc.verify_score(token)  # a session token can never post a score


def test_score_token_cannot_be_forged_or_altered():
    svc = TokenService(SECRET, 60, 60)
    tok = svc.issue_score(ScoreClaims("g", "s", 300, 2000, 2, 10, "te-IN", "p"))
    payload = jwt.decode(tok, options={"verify_signature": False})
    payload["sc"] = 999999
    forged = jwt.encode(payload, "y" * 40, algorithm="HS256")
    with pytest.raises(TokenError):
        svc.verify_score(forged)
    unsigned = jwt.encode(payload, None, algorithm="none")
    with pytest.raises(TokenError):
        svc.verify_score(unsigned)


def test_expired_token_rejected():
    svc = TokenService(SECRET, 60, 60)
    payload = {
        "iss": "maata-arcade",
        "aud": "session",
        "iat": 1,
        "nbf": 1,
        "exp": 2,
        "jti": "j",
        "sid": "s",
        "iph": "i",
    }
    with pytest.raises(TokenError):
        svc.verify_session(jwt.encode(payload, SECRET, algorithm="HS256"))


def test_short_secret_refused():
    with pytest.raises(ValueError):
        TokenService("short", 60, 60)


# ---------------------------------------------------------------- config -----------
def test_production_refuses_unsafe_config():
    with pytest.raises(ValueError) as info:
        Settings(env="production", _env_file=None)
    msg = str(info.value)
    for needle in ("GNANI_API_KEY", "JWT_SECRET", "test key", "TURNSTILE_HOSTNAME"):
        assert needle in msg


def test_production_accepts_safe_config():
    s = Settings(
        env="production",
        _env_file=None,
        gnani_api_key="k",
        jwt_secret="a" * 40,
        ip_hash_secret="b" * 40,
        turnstile_secret="real-secret",
        turnstile_hostname="maata.ourspaces.net",
        allowed_origins="https://maata.ourspaces.net",
        public_origin="https://maata.ourspaces.net",
    )
    assert s.allowed_origins == ["https://maata.ourspaces.net"]


def test_origin_is_exact_match():
    allowed = ["https://maata.ourspaces.net"]
    assert origin_allowed("https://maata.ourspaces.net", allowed)
    for bad in (
        None,
        "",
        "null",
        "https://maata.ourspaces.net.evil.io",
        "http://maata.ourspaces.net",
        "https://evil.ourspaces.net",
    ):
        assert not origin_allowed(bad, allowed)


def test_ip_hash_is_keyed():
    assert hash_ip("1.2.3.4", "a" * 32) != hash_ip("1.2.3.4", "b" * 32)
    assert "1.2.3.4" not in hash_ip("1.2.3.4", "a" * 32)


# ---------------------------------------------------------------- redis-backed ------
@pytest.fixture
def fredis():
    return fakeredis.FakeAsyncRedis()


async def test_rate_limiter_window(fredis):
    rl = RateLimiter(fredis)
    results = [await rl.hit("b", "id", 3) for _ in range(5)]
    assert [r.allowed for r in results] == [True, True, True, False, False]
    assert results[-1].retry_after_s >= 1


async def test_float_cap(fredis):
    rl = RateLimiter(fredis)
    assert (await rl.consume_float("a", "id", 4.0, 10.0, 60))[0]
    assert (await rl.consume_float("a", "id", 5.0, 10.0, 60))[0]
    ok, total = await rl.consume_float("a", "id", 2.0, 10.0, 60)
    assert not ok and total == pytest.approx(9.0)


async def test_budget_daily_cap_kill_switch_and_alerts(fredis):
    sent: list[str] = []
    budget = CreditBudget(
        fredis,
        daily_budget=10,
        credits_total=100,
        credits_per_stt_minute=2,
        credits_per_1k_tts_chars=1,
        env_kill_switch=False,
    )
    budget._fire_webhook = sent.append  # type: ignore[method-assign]
    assert budget.stt_cost(30) == pytest.approx(1.0)
    assert budget.tts_cost(500) == pytest.approx(0.5)
    assert await budget.is_open()
    await budget.charge(5.1, kind="stt")
    assert len(sent) == 1 and "50%" in sent[0]
    await budget.charge(0.1, kind="stt")
    assert len(sent) == 1  # each threshold alerts once
    await budget.charge(5, kind="tts")
    st = await budget.status()
    assert not st.open and st.reason == "daily_budget_exhausted"
    assert any("100%" in m for m in sent)
    await fredis.flushall()
    await budget.set_kill_switch(True)
    assert (await budget.status()).reason == "kill_switch"
    await budget.set_kill_switch(False)
    assert await budget.is_open()


# ---------------------------------------------------------------- voice ------------
def test_framer_emits_exact_frames():
    f = PcmFramer()
    out = f.push(b"\x01" * 700) + f.push(b"\x02" * 700) + f.push(b"\x03" * 1000)
    assert all(len(x) == FRAME_BYTES for x in out) and len(out) == 2
    last = f.flush()
    assert last is not None and len(last) == FRAME_BYTES and last.endswith(b"\x00")
    assert f.flush() is None


async def test_stt_stream_paces_frames_at_realtime(clean_gnani):
    stt = SttStream(url=clean_gnani.stt_url, api_key=API_KEY, language="te-IN")
    await stt.open()
    stt.feed(silence(1.0))  # a burst of 1 s arrives at once
    await asyncio.sleep(1.3)
    await stt.close()
    times = clean_gnani.state.stt_frame_times
    assert len(times) == 31  # 16000*2 / 1024 = 31.25
    span = times[-1] - times[0]
    assert 0.85 <= span <= 1.2, span  # paced over ~1 s, not burst
    assert clean_gnani.state.stt_violations == []
    assert stt.audio_seconds_sent == pytest.approx(31 * 0.032)


async def test_stt_bad_key_is_auth_error(clean_gnani):
    stt = SttStream(url=clean_gnani.stt_url, api_key="wrong", language="te-IN", connect_retries=0)
    with pytest.raises(GnaniAuthError):
        await stt.open()


async def test_stt_retries_then_fails_on_503(clean_gnani):
    clean_gnani.state.fail_stt_handshake_status = 503
    stt = SttStream(url=clean_gnani.stt_url, api_key=API_KEY, language="te-IN", connect_retries=1)
    t0 = time.monotonic()
    with pytest.raises(GnaniError) as info:
        await stt.open()
    assert info.value.retryable and time.monotonic() - t0 >= 0.3


async def test_tts_streams_and_reuses_connection(clean_gnani):
    tts = TtsStreamer(url=clean_gnani.tts_url, api_key=API_KEY, model="timbre-v2.5")
    for _ in range(2):
        audio = b"".join([c async for c in tts.stream("నమస్తే", voice="Suhana", language="te-IN")])
        assert len(audio) == int(0.4 * 24000) * 2
    assert len(clean_gnani.state.tts_requests) == 2
    req = clean_gnani.state.tts_requests[0]
    assert req["audio_config"]["encoding"] == "pcm_s16le" and req["voice"] == "Suhana"
    await tts.close()


@pytest.mark.parametrize("trailer", [True, False])
async def test_tts_lines_never_get_each_others_audio(clean_gnani, trailer):
    # Timbre sends a "Streaming completed" trailer after the final chunk and reuses the request
    # id. A trailer left unread used to end the next line early (empty) and hand the line after
    # it the previous line's audio.
    clean_gnani.state.tts_s_per_char = 0.05
    clean_gnani.state.tts_trailer = trailer
    tts = TtsStreamer(url=clean_gnani.tts_url, api_key=API_KEY, model="timbre-v2.5")
    for text in ["one", "a longer line", "mid line", "x", "the final line of five"]:
        audio = b"".join([c async for c in tts.stream(text, voice="Shlok", language="en-IN")])
        assert len(audio) == int(len(text) * 0.05 * 24000) * 2, text
    await tts.close()


async def test_tts_bad_key(clean_gnani):
    tts = TtsStreamer(
        url=clean_gnani.tts_url, api_key="nope", model="timbre-v2.5", connect_retries=0
    )
    with pytest.raises(GnaniAuthError):
        async for _ in tts.stream("hi", voice="Nalini", language="hi-IN"):
            pass


def test_vad_triggers_on_speech_not_silence_or_noise():
    vad = BargeInDetector()
    for _ in range(50):
        assert not vad.update(silence(0.02))
    noise = tone(0.02, amp=60)
    for _ in range(50):
        assert not vad.update(noise)
    fired = [vad.update(tone(0.02, amp=8000)) for _ in range(12)]
    assert any(fired) and not fired[0]  # needs sustained speech, not one frame
    assert rms_dbfs(b"") == -120.0


async def test_audio_cache_atomic_and_keyed(tmp_path):
    cache = AudioCache(tmp_path)
    k1 = cache_key(model="m", voice="v", language="te-IN", speed=1.0, text="a")
    assert k1 != cache_key(model="m", voice="v2", language="te-IN", speed=1.0, text="a")
    assert await cache.read(k1) is None
    await cache.put(k1, b"\x01\x02")
    assert await cache.read(k1) == b"\x01\x02"
    assert not list(tmp_path.rglob("*.tmp"))
    with pytest.raises(ValueError):
        cache.has("../../etc/passwd")


# ---------------------------------------------------------------- packs/lines -------
def test_pack_library_requires_review_in_production():
    strict = PackLibrary.load(FIXTURES / "packs", require_review=True)
    assert strict.get("hi-test-01") and strict.get("hi-unreviewed") is None
    loose = PackLibrary.load(FIXTURES / "packs", require_review=False)
    assert loose.get("hi-unreviewed")


def test_pack_validation_rejects_bad_input():
    good = (FIXTURES / "packs" / "hi-test-01.json").read_text(encoding="utf-8")
    with pytest.raises(ValueError):
        parse_pack(good.replace('"hi-IN"', '"xx-XX"'))
    with pytest.raises(ValueError):
        parse_pack(good.replace('"schema": 1,', '"schema": 1, "evil": true,'))
    with pytest.raises(ValueError):
        parse_pack(b"{" + b" " * 300_000 + b"}")
    with pytest.raises(ValueError):
        Question(id="q1", prompt="How many?", answers=["seven"], display_answer="7", kind="number")


def test_pack_strips_bidi_overrides():
    q = Question(id="q1", prompt="abc‮def?", answers=["x​y"], display_answer="x")
    assert "‮" not in q.prompt


def test_lines_file_is_complete():
    lines = Lines.load(SERVER_DIR / "content" / "lines.json")
    assert "{answer}" not in lines.get("te-IN", "answer_was", answer="పది")
    assert len(lines.all_static("hi-en")) == 6


# ---------------------------------------------------------------- matching ----------
Q_TEXT = Question(
    id="q", prompt="భారతదేశ రాజధాని ఏది?", answers=["ఢిల్లీ", "delhi", "new delhi"], display_answer="ఢిల్లీ"
)
Q_NUM = Question(
    id="n", prompt="ఒక వారంలో ఎన్ని రోజులు?", answers=["7"], display_answer="ఏడు", kind="number"
)


@pytest.mark.parametrize(
    "heard,ok",
    [
        ("ఢిల్లీ", True),
        ("ఢిల్లీ.", True),
        ("Delhi", True),
        ("answer is New Delhi", True),
        ("ముంబై", False),
        ("", False),
        ("mumbai chennai kolkata bangalore hyderabad delhi", False),  # list of guesses
    ],
)
def test_text_matching(heard, ok):
    assert match_answer(heard, Q_TEXT).correct is ok


@pytest.mark.parametrize(
    "heard,ok",
    [
        ("7", True),
        ("౭", True),
        ("७ दिन", True),
        ("7.0", True),
        ("17", False),
        ("1 2 3 4 5 6 7", False),
    ],
)
def test_number_matching(heard, ok):
    assert match_answer(heard, Q_NUM).correct is ok


def test_normalize_and_echo():
    assert normalize("  Hello,   WORLD!! ") == "hello world"
    assert looks_like_echo("భారతదేశ రాజధాని ఏది అని", Q_TEXT.prompt + " అని")
    assert not looks_like_echo("ఢిల్లీ", Q_TEXT.prompt)


def test_scoring():
    assert scoring.points_for(correct=False, remaining_s=5, limit_s=10, streak=0) == 0
    assert scoring.points_for(correct=True, remaining_s=10, limit_s=10, streak=1) == 150
    assert scoring.points_for(correct=True, remaining_s=0, limit_s=10, streak=3) == 120
    assert scoring.max_score(2) == 150 + 160


# ---------------------------------------------------------------- nicknames ---------
@pytest.mark.parametrize("nick", ["Vector", "వెక్టర్", "राहुल_07", "Ali Khan"])
def test_valid_nicknames(nick):
    assert validate_nickname(nick)


@pytest.mark.parametrize(
    "nick", ["ab", "x" * 17, "<script>", "a‮b c", "1234", "GnaniOfficial", "ad min", "hi@x.com"]
)
def test_invalid_nicknames(nick):
    with pytest.raises(NicknameError):
        validate_nickname(nick)


def test_list_settings_parse_from_csv_env(monkeypatch):
    monkeypatch.setenv("MAATA_ALLOWED_ORIGINS", "https://a.example, https://b.example")
    monkeypatch.setenv("MAATA_TRUSTED_PROXIES", "172.31.240.1/32,127.0.0.1/32")
    s = Settings(_env_file=None)
    assert s.allowed_origins == ["https://a.example", "https://b.example"]
    assert s.trusted_proxies == ["172.31.240.1/32", "127.0.0.1/32"]


def test_list_of_pack_answers_is_wrong():
    others = frozenset({"mumbai", "paris", "7"})
    assert match_answer("delhi", Q_TEXT, others).correct
    assert not match_answer("paris delhi", Q_TEXT, others).correct
    assert not match_answer("7 or 8", Q_NUM).correct


def test_ipv6_rate_identity_is_the_64():
    from app.security.client_ip import rate_identity

    a = hash_ip("2401:4900:1c3a:1:aaaa::1", "s" * 32)
    b = hash_ip("2401:4900:1c3a:1:ffff:1234::9", "s" * 32)
    c = hash_ip("2401:4900:1c3a:2::1", "s" * 32)
    assert a == b != c
    assert rate_identity("::ffff:1.2.3.4") == "1.2.3.4"
    assert rate_identity("1.2.3.4") == "1.2.3.4"


# ---------------------------------------------------------------- matching: extended -
Q_HI = Question(
    id="h", prompt="भारत की राजधानी क्या है?", answers=["दिल्ली", "नई दिल्ली"], display_answer="दिल्ली"
)
Q_LATIN = Question(
    id="l", prompt="Cricket World Cup 2011 kisne jeeta?", answers=["india"], display_answer="India"
)
Q_CITY = Question(id="c", prompt="తెలంగాణ రాజధాని ఏది?", answers=["హైదరాబాద్"], display_answer="హైదరాబాద్")


@pytest.mark.parametrize(
    "heard,question,ok",
    [
        ("दिल्ली", Q_TEXT, True),  # Devanagari for a Telugu answer
        ("దిల్లీ", Q_TEXT, True),  # the other common Telugu spelling
        ("dilli", Q_HI, True),
        ("Delhi", Q_HI, True),
        ("newdelhi", Q_TEXT, True),  # word breaks vary
        ("नयी दिल्ली", Q_HI, True),
        ("इंडिया", Q_LATIN, True),
        ("ఇండియా", Q_LATIN, True),
        ("hyderabad", Q_CITY, True),  # English spelling, one vowel off the transliteration
        ("हैदराबाद", Q_CITY, True),
        ("मुंबई", Q_HI, False),
        ("dal", Q_HI, False),
        ("secunderabad", Q_CITY, False),
    ],
)
def test_transliterated_answers(heard, question, ok):
    assert match_answer(heard, question).correct is ok


@pytest.mark.parametrize(
    "heard,language,ok",
    [
        ("I think the answer is New Delhi", "hi-en", True),
        ("जवाब है दिल्ली", "hi-IN", True),
        ("मुझे लगता है जवाब दिल्ली है", "hi-IN", True),
        ("సమాధానం ఢిల్లీ అనుకుంటా", "te-IN", True),
        ("mera jawab hai dilli", "hi-en", True),
        ("um i think mumbai chennai kolkata delhi", "hi-en", False),  # fillers can't hide a list
        ("जवाब है", "hi-IN", False),
    ],
)
def test_filler_words(heard, language, ok):
    assert match_answer(heard, Q_TEXT, language=language).correct is ok
    assert match_answer(heard, Q_TEXT).correct is ok  # no language: every list applies


def test_filler_that_is_the_answer_still_counts():
    q = Question(id="y", prompt="Is the sky blue?", answers=["yes", "हाँ"], display_answer="Yes")
    assert match_answer("yeah yes", q, language="hi-en").correct
    q = Question(id="i", prompt="Which pronoun?", answers=["it"], display_answer="it")
    assert match_answer("it", q, language="hi-en").correct


@pytest.mark.parametrize(
    "heard,ok",
    [
        ("ఏడు", True),
        ("ఏడు రోజులు", True),
        ("सात", True),
        ("सात दिन होते हैं", True),
        ("saat", True),
        ("seven", True),
        ("सेवन", True),
        ("the answer is seven days", True),
        ("ఒక వారంలో ఏడు రోజులు", True),
        ("साठ", False),  # 60, one aspirate away from सात
        ("ఆరు", False),
        ("six or seven", False),
        ("ఆరు ఏడు", False),
        ("seventeen", False),
        ("I sat down", False),  # "sat" is 7 only when it stands alone
    ],
)
def test_spoken_numbers(heard, ok):
    assert match_answer(heard, Q_NUM).correct is ok


@pytest.mark.parametrize(
    "heard,answer",
    [
        ("उन्नीस सौ सैंतालीस", "1947"),
        ("nineteen forty seven", None),  # two numbers, not a year: reject rather than guess
        ("one thousand nine hundred and forty seven", "1947"),
        ("వెయ్యి తొమ్మిది వందల నలభై ఏడు", "1947"),
        ("పందొమ్మిది వందల నలభై ఏడు", "1947"),
        ("ఇరవై ఒకటి", "21"),
        ("ఇరవయ్యొకటి", "21"),
        ("इक्कीस", "21"),
        ("twenty one", "21"),
        ("डेढ़ सौ", None),
        ("నూట యాభై", "150"),
        ("एक सौ पचास", "150"),
        ("दो लाख", "200000"),
        ("three point one four", "3.14"),
        ("do", "2"),
        ("zero", "0"),
        ("శూన్యం", None),
    ],
)
def test_number_words_parse_to_values(heard, answer):
    for value in ("1947", "21", "150", "200000", "3.14", "2", "0"):
        q = Question(id="v", prompt="?!?", answers=[value], display_answer=value, kind="number")
        assert match_answer(heard, q).correct is (value == answer), (heard, value)


def test_other_answer_in_another_script_is_a_second_guess():
    others = frozenset({"mumbai", "पेरिस"})
    assert match_answer("దిల్లీ", Q_TEXT, others).correct
    assert not match_answer("ముంబై దిల్లీ", Q_TEXT, others).correct


def test_numbers_repeated_from_the_question_are_not_guesses():
    q = Question(
        id="w",
        prompt="एक हफ़्ते में कितने दिन होते हैं?",
        answers=["7"],
        display_answer="सात",
        kind="number",
    )
    assert match_answer("एक हफ़्ते में सात दिन", q).correct
    assert not match_answer("एक", q).correct
    assert not match_answer("सात या आठ", q).correct


def test_all_five_languages_route_and_have_lines():
    from app.game.languages import LANGUAGES, route

    assert set(LANGUAGES) == {"te-IN", "hi-IN", "hi-en", "te-en", "en-IN"}
    # Tenglish listens in Telugu mode (live-tested): English words come back in Telugu script.
    assert route("te-en").stt_lang == "te-IN" and route("te-en").tts_lang == "te-IN"
    assert route("en-IN").stt_lang == "en-IN" and route("en-IN").voice == "Girish"
    lines = Lines.load(SERVER_DIR / "content" / "lines.json")
    for code in LANGUAGES:
        assert "{answer}" not in lines.get(code, "answer_was", answer="x")


def test_tenglish_transcripts_match_across_scripts():
    q = Question(
        id="n", prompt="Week lo enni rojulu?", answers=["7"], display_answer="7", kind="number"
    )
    assert match_answer("ఆన్సర్ సెవెన్ అనుకుంటా", q, language="te-en").correct
    q2 = Question(
        id="c", prompt="Telangana capital edi?", answers=["hyderabad"], display_answer="Hyderabad"
    )
    assert match_answer("నా ఆన్సర్ హైదరాబాద్", q2, language="te-en").correct


def test_story_branches_on_answers():
    pack = parse_pack((FIXTURES / "packs" / "hi-story-01.json").read_bytes())
    story = pack.story
    assert story is not None
    assert pack.summary()["story"] == {
        "wizard": story.wizard,
        "wizard_sprite": story.wizard_sprite,
        "scene": story.scene,
        "chapters": len(story.chapters),
    }
    assert story.chapter(1) == story.chapters[0]
    assert story.chapter(len(story.chapters) + 1) is None  # more right answers than chapters
    assert story.setback(1) == story.setbacks[0]
    assert story.setback(3) == story.setbacks[0]  # setbacks cycle
    assert story.ending(9, 10)[0] == "great"
    assert story.ending(5, 10)[0] == "good"
    assert story.ending(2, 10)[0] == "try_again"
    assert len(story.all_lines()) == 1 + len(story.chapters) + len(story.setbacks) + 3


def test_story_schema_limits():
    import json as _json

    raw = _json.loads((FIXTURES / "packs" / "hi-story-01.json").read_text(encoding="utf-8"))
    raw["story"]["chapters"] = ["x" * 300, "ok line", "ok line"]
    with pytest.raises(ValueError):
        parse_pack(_json.dumps(raw))
    raw = _json.loads((FIXTURES / "packs" / "hi-story-01.json").read_text(encoding="utf-8"))
    raw["story"]["evil"] = True
    with pytest.raises(ValueError):
        parse_pack(_json.dumps(raw))


def test_story_voice_scene_and_sprite():
    import json as _json

    from app.game.languages import route_for_pack

    base = _json.loads((FIXTURES / "packs" / "hi-story-01.json").read_text(encoding="utf-8"))
    pack = parse_pack(_json.dumps(base))
    assert pack.story is not None
    assert (pack.story.wizard_sprite, pack.story.scene, pack.story.voice) == (
        "sage",
        "library-a",
        None,
    )
    assert route_for_pack(pack).voice == "Nalini"  # language default

    raw = _json.loads(_json.dumps(base))
    raw["story"].update(voice="Jalaj", wizard_sprite="owl", scene="crystal-cave")
    pack = parse_pack(_json.dumps(raw))
    route = route_for_pack(pack)
    assert route.voice == "Jalaj" and route.tts_lang == "hi-IN" and route.stt_lang == "hi-IN"

    for field, bad in (
        ("voice", "Girish"),  # an en-IN voice in a Hindi pack
        ("voice", "../etc"),
        ("wizard_sprite", "dragon"),
        ("scene", "../../secrets"),
    ):
        raw = _json.loads(_json.dumps(base))
        raw["story"][field] = bad
        with pytest.raises(ValueError):
            parse_pack(_json.dumps(raw))


def test_builtin_story_packs_are_valid():
    """The hand-written starter packs parse, use their own language's voices and hit every
    branch of the story (each pack has enough chapters for a perfect run)."""
    from app.game.languages import VOICES, route_for_pack

    drafts = sorted((SERVER_DIR / "packs" / "drafts").glob("*.json"))
    langs = set()
    for path in drafts:
        pack = parse_pack(path.read_bytes())
        if pack.story is None:
            continue
        langs.add(pack.language)
        route = route_for_pack(pack)
        assert route.voice in VOICES[route.tts_lang]
        assert len(pack.story.chapters) >= min(len(pack.questions), 8)
        assert all(q.options is not None for q in pack.questions), pack.id
    assert langs == {"te-IN", "hi-IN", "hi-en", "te-en", "en-IN"}


def test_characters_allowlist():
    from app.game.characters import CHARACTERS, valid_character

    assert valid_character(None) == "arjun" and len(CHARACTERS) == 20
    assert len(set(CHARACTERS)) == 20
    assert all(valid_character(c) == c for c in CHARACTERS)
    for bad in ("<script>", "", "ARJUN", "robot", 7, ["arjun"]):
        assert valid_character(bad) is None


def test_score_token_carries_character():
    svc = TokenService(SECRET, 60, 60)
    tok = svc.issue_score(ScoreClaims("g", "s", 1, 10, 1, 2, "te-en", "p", "zara"))
    assert svc.verify_score(tok)[0].character == "zara"


def test_options_need_exactly_one_right_answer():
    ok = Question(
        id="o",
        prompt="Capital of India?",
        answers=["new delhi", "delhi"],
        display_answer="New Delhi",
        options=["New Delhi", "Mumbai", "Chennai"],
    )
    assert ok.options == ["New Delhi", "Mumbai", "Chennai"]
    for opts in (
        ["Mumbai", "Chennai", "Pune"],
        ["Delhi", "New Delhi", "Pune"],
        ["Mumbai", "Mumbai", "New Delhi"],
        ["New Delhi", "Mumbai"],
    ):
        with pytest.raises(ValueError):
            Question(
                id="o",
                prompt="Capital of India?",
                answers=["new delhi", "delhi"],
                display_answer="New Delhi",
                options=opts,
            )


def test_wizard_picks_the_narrator_voice():
    from app.game.languages import (
        DEFAULT_WIZARD,
        LANGUAGES,
        VOICE_CATALOG,
        WIZARD_GENDER,
        WIZARD_VOICES,
        WIZARDS,
        route_for_game,
        route_for_wizard,
        valid_wizard,
    )

    pack = parse_pack((FIXTURES / "packs" / "hi-story-01.json").read_bytes())
    assert DEFAULT_WIZARD == "sorceress"
    assert route_for_game(pack, "sorceress").voice == "Nalini"
    assert route_for_game(pack, "sage").voice == "Roopesh"
    assert route_for_game(pack, "owl").voice == "Omkar"
    for code in LANGUAGES:
        voices = [WIZARD_VOICES[code][w] for w in WIZARDS]
        # Every wizard sounds different, and male wizards have male voices.
        assert len(set(voices)) == len(WIZARDS), code
        for wizard in WIZARDS:
            r = route_for_wizard(code, wizard)
            assert r.voice in VOICE_CATALOG, (code, wizard)
            assert VOICE_CATALOG[r.voice][1] == WIZARD_GENDER[wizard], (code, wizard)
            # Only Poorvi speaks hi-en; Hindi voices read Hinglish as hi-IN.
            assert (r.tts_lang == "hi-en") == (r.voice == "Poorvi"), (code, wizard)
    for bad in (None, "", "dragon", "SAGE", 3, ["owl"]):
        assert valid_wizard(bad) is None
    assert all(valid_wizard(w) == w for w in WIZARDS)


# ---------------------------------------------------------------- speech playout ---
def test_playout_tracks_when_the_client_finishes(monkeypatch):
    from app.ws import play

    now = [100.0]
    monkeypatch.setattr(play.time, "monotonic", lambda: now[0])
    second = play.TTS_BYTES_PER_S
    lead = play.PLAYOUT_LEAD_S

    # A cached line arrives at once: it ends one lead after sending plus its length.
    p = play.Playout()
    for _ in range(5):
        p.sent(second // 5)
    assert p.ends_at == pytest.approx(100.0 + lead + 1.0)

    # A live line whose first chunk takes 1.5 s, then streams slower than real time: the
    # client's queue runs dry, so playback ends well after "start + length".
    p = play.Playout()
    now[0] = 101.5
    p.sent(second // 5)
    for _ in range(4):
        now[0] += 0.4  # 200 ms of audio every 400 ms
        p.sent(second // 5)
    assert p.ends_at == pytest.approx(now[0] + lead + 0.2)
    assert p.ends_at > 100.0 + 1.0 + 1.5
