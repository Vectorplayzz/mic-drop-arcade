"""Pre-render every line the game can speak, once, into the audio cache.

Covers:
- the fixed lines in content/lines.json;
- every wizard's own reaction lines (content/wizards.json);
- for each reviewed adventure, every line it can speak;
- for each reviewed quiz pack, every question and its "the answer was ..." line.

Adventure lines are rendered in the default wizard's voice unless --all-wizards is given. Other
wizards fill the cache the first time someone plays with them. Already-cached lines are
skipped, so re-running costs nothing.

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
from app.game.adventures import AdventureLibrary
from app.game.languages import (
    DEFAULT_WIZARD,
    LANGUAGES,
    WIZARDS,
    LanguageRoute,
    route_for_game,
    route_for_wizard,
)
from app.game.lines import Lines
from app.game.packs import PackLibrary
from app.game.wizards import WizardLines
from app.gnani.errors import GnaniError
from app.gnani.tts import synthesize_rest
from app.voice.cache import AudioCache, cache_key

Item = tuple[LanguageRoute, str]


def collect(
    lines: Lines,
    packs: PackLibrary,
    adventures: AdventureLibrary | None = None,
    wizard_lines: WizardLines | None = None,
    *,
    all_wizards: bool = False,
) -> list[Item]:
    """Return unique (route, text) pairs: every line a game can speak.

    The player's wizard picks the voice and speed, so a line is rendered once per wizard.
    """
    items: dict[tuple[str, str, float, str], Item] = {}

    def add(r: LanguageRoute, text: str) -> None:
        items.setdefault((r.code, r.voice, r.speed, text), (r, text))

    # Adventures first (the main mode), then the wizards' own lines, then the quiz.
    if adventures is not None:
        wizards = WIZARDS if all_wizards else (DEFAULT_WIZARD,)
        for adventure in adventures.everything():
            for lang in LANGUAGES:
                for wizard in wizards:
                    r = route_for_wizard(lang, wizard)
                    for text in adventure.all_lines(lang):
                        add(r, text)
    for lang in LANGUAGES:
        for wizard in WIZARDS:
            r = route_for_wizard(lang, wizard)
            for text in lines.all_static(lang):
                add(r, text)
            if wizard_lines is not None:
                for text in wizard_lines.all_tts(lang, wizard):
                    add(r, text)
    for pack in packs.list():
        for wizard in WIZARDS:
            r = route_for_game(pack, wizard)
            for q in pack.questions:
                add(r, q.prompt)
                add(r, lines.get(pack.language, "answer_was", answer=q.display_answer))
            if pack.story is not None:
                for line in pack.story.all_lines():
                    add(r, line)
    return list(items.values())


async def render(
    todo: list[tuple[LanguageRoute, str, str]], cache: AudioCache, concurrency: int
) -> int:
    s = get_settings()
    sem = asyncio.Semaphore(concurrency)
    failures = 0

    async def one(client: httpx.AsyncClient, r: LanguageRoute, text: str, key: str) -> None:
        nonlocal failures
        async with sem:
            for attempt in range(6):
                try:
                    pcm = await synthesize_rest(
                        client,
                        url=s.gnani_tts_rest_url,
                        api_key=s.gnani_api_key.get_secret_value(),
                        model=s.gnani_tts_model,
                        text=text,
                        voice=r.voice,
                        language=r.tts_lang,
                        speed=r.speed,
                    )
                    if len(pcm) < 2400:  # under 50 ms: Timbre returned no real audio
                        raise GnaniError("tts returned no audio", retryable=True)
                    await cache.put(key, pcm)
                    print(f"  ok   {r.code} {r.voice:8} {r.speed:.2f} {text[:50]}")
                    return
                except (GnaniError, httpx.TransportError) as exc:
                    # Network blips (DNS, resets) are retried like Gnani's own 429s/5xx.
                    retryable = isinstance(exc, httpx.TransportError) or exc.retryable
                    if not retryable or attempt == 5:
                        failures += 1
                        print(f"  FAIL {r.code}  {text[:50]}  ({exc})", file=sys.stderr)
                        return
                    # Gnani rate-limits bursts (HTTP 429); back off well beyond a second.
                    await asyncio.sleep(min(2 ** (attempt + 1), 30))

    async with httpx.AsyncClient() as client:
        await asyncio.gather(*(one(client, r, text, key) for r, text, key in todo))
    return failures


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--yes", action="store_true", help="confirm spending credits")
    p.add_argument("--concurrency", type=int, default=2)
    p.add_argument(
        "--all-wizards", action="store_true", help="render adventures in every wizard's voice"
    )
    args = p.parse_args()

    s = get_settings()
    lines = Lines.load(s.lines_file)
    packs = PackLibrary.load(s.packs_dir, require_review=True)
    adventures = AdventureLibrary.load(s.adventures_dir, require_review=True)
    wizard_lines = WizardLines.load(s.wizard_lines_file)
    cache = AudioCache(s.audio_cache_dir)
    todo = []
    for r, text in collect(lines, packs, adventures, wizard_lines, all_wizards=args.all_wizards):
        key = cache_key(
            model=s.gnani_tts_model, voice=r.voice, language=r.tts_lang, speed=r.speed, text=text
        )
        if not cache.has(key):
            todo.append((r, text, key))
    chars = sum(len(t) for _, t, _ in todo)
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
