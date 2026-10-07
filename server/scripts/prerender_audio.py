"""Pre-render every line the game can speak, once, into the audio cache.

Covers the fixed lines in content/lines.json plus, for each reviewed pack, every question and its
"the answer was ..." line. Already-cached lines are skipped, so re-running costs nothing.

    python scripts/prerender_audio.py --dry-run     # count lines and characters
    python scripts/prerender_audio.py --yes         # synthesise what's missing
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.game.languages import LANGUAGES, WIZARD_VOICES, WIZARDS, route, route_for_game
from app.game.lines import Lines
from app.game.packs import PackLibrary
from app.gnani.errors import GnaniError
from app.gnani.tts import synthesize_rest
from app.voice.cache import AudioCache, cache_key


def collect(lines: Lines, packs: PackLibrary) -> list[tuple[str, str, str]]:
    """Return unique (language, voice, text) triples: every line any game can speak.

    The player's wizard picks the voice, so every line is rendered once per wizard voice.
    """
    items: dict[tuple[str, str, str], None] = {}
    for lang in LANGUAGES:
        for voice in sorted(set(WIZARD_VOICES[lang].values())):
            for text in lines.all_static(lang):
                items[(lang, voice, text)] = None
    for pack in packs.list():
        for wizard in WIZARDS:
            voice = route_for_game(pack, wizard).voice
            for q in pack.questions:
                items[(pack.language, voice, q.prompt)] = None
                answer_line = lines.get(pack.language, "answer_was", answer=q.display_answer)
                items[(pack.language, voice, answer_line)] = None
            if pack.story is not None:
                for line in pack.story.all_lines():
                    items[(pack.language, voice, line)] = None
    return list(items)


async def render(todo: list[tuple[str, str, str, str]], cache: AudioCache, concurrency: int) -> int:
    s = get_settings()
    sem = asyncio.Semaphore(concurrency)
    failures = 0

    async def one(client: httpx.AsyncClient, lang: str, voice: str, text: str, key: str) -> None:
        nonlocal failures
        r = route(lang)
        async with sem:
            for attempt in range(6):
                try:
                    pcm = await synthesize_rest(
                        client,
                        url=s.gnani_tts_rest_url,
                        api_key=s.gnani_api_key.get_secret_value(),
                        model=s.gnani_tts_model,
                        text=text,
                        voice=voice,
                        language=r.tts_lang,
                        speed=r.speed,
                    )
                    await cache.put(key, pcm)
                    print(f"  ok   {lang} {voice:8} {text[:50]}")
                    return
                except GnaniError as exc:
                    if not exc.retryable or attempt == 5:
                        failures += 1
                        print(f"  FAIL {lang}  {text[:50]}  ({exc})", file=sys.stderr)
                        return
                    # Gnani rate-limits bursts (HTTP 429); back off well beyond a second.
                    await asyncio.sleep(min(2 ** (attempt + 1), 30))

    async with httpx.AsyncClient() as client:
        await asyncio.gather(
            *(one(client, lang, voice, text, key) for lang, voice, text, key in todo)
        )
    return failures


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--yes", action="store_true", help="confirm spending credits")
    p.add_argument("--concurrency", type=int, default=2)
    args = p.parse_args()

    s = get_settings()
    lines = Lines.load(s.lines_file)
    packs = PackLibrary.load(s.packs_dir, require_review=True)
    cache = AudioCache(s.audio_cache_dir)
    todo = []
    for lang, voice, text in collect(lines, packs):
        r = route(lang)
        key = cache_key(
            model=s.gnani_tts_model, voice=voice, language=r.tts_lang, speed=r.speed, text=text
        )
        if not cache.has(key):
            todo.append((lang, voice, text, key))
    chars = sum(len(t) for _, _, t, _ in todo)
    print(f"{len(todo)} lines to render ({chars} characters).")
    if args.dry_run or not todo:
        return 0
    if not args.yes:
        print("Re-run with --yes to synthesise them.")
        return 1
    if not s.gnani_api_key.get_secret_value():
        print("MAATA_GNANI_API_KEY is not set.", file=sys.stderr)
        return 1
    failures = asyncio.run(render(todo, cache, max(1, min(args.concurrency, 4))))
    print(f"Done with {failures} failures.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
