"""Export an adventure's English text for translation, and merge translations back.

Every localized field in an adventure file is an object keyed by language. ``export`` flattens
the English side into ``{path: text-or-list}``, and ``merge`` writes a translated table back
into the file under one language. Paths are slash-joined keys and list indexes, e.g.
``nodes/t_start/say/0`` or ``nodes/t_start/choices/1/keywords``.

    python scripts/adventure_i18n.py export adventures/drafts/fest-night.json > fest.en.json
    python scripts/adventure_i18n.py merge adventures/drafts/fest-night.json hi-IN fest.hi.json
    python scripts/adventure_i18n.py check adventures/drafts/fest-night.json

``merge`` refuses a table whose keys don't match the export exactly, or whose list fields have
the wrong number of entries for puzzle options.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SOURCE = "en-IN"
LANGS = ("en-IN", "hi-IN", "hi-en", "te-IN", "te-en")
TTS_VARIANTS = ("hi-en@tts", "te-en@tts")


def _walk(obj: Any, path: list[str], out: dict[str, Any]) -> None:
    if isinstance(obj, dict):
        if SOURCE in obj and set(obj) <= {*LANGS, *TTS_VARIANTS}:
            out["/".join(path)] = obj[SOURCE]
            return
        for k, v in obj.items():
            _walk(v, [*path, k], out)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _walk(v, [*path, str(i)], out)


def export(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    _walk(data, [], out)
    return out


def _get(data: Any, path: str) -> dict[str, Any]:
    node = data
    for part in path.split("/"):
        node = node[int(part)] if isinstance(node, list) else node[part]
    return node


def merge(data: dict[str, Any], lang: str, table: dict[str, Any]) -> list[str]:
    if lang not in (*LANGS, *TTS_VARIANTS) or lang == SOURCE:
        raise SystemExit(f"language must be one of {(*LANGS[1:], *TTS_VARIANTS)}")
    source = export(data)
    problems = [f"missing {k}" for k in source if k not in table]
    problems += [f"unexpected {k}" for k in table if k not in source]
    for key, en in source.items():
        value = table.get(key)
        if value is None:
            continue
        if isinstance(en, list) != isinstance(value, list):
            problems.append(f"{key}: expected {'a list' if isinstance(en, list) else 'text'}")
        elif key.endswith("/options") and len(value) != len(en):
            problems.append(f"{key}: needs exactly {len(en)} options")
    if problems:
        return problems
    for key, value in table.items():
        _get(data, key)[lang] = value
    return []


def check(data: dict[str, Any]) -> list[str]:
    missing = []
    for key in export(data):
        have = _get(data, key)
        missing += [f"{key}: no {lang}" for lang in LANGS if lang not in have]
    return missing


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export")
    e.add_argument("file", type=Path)
    m = sub.add_parser("merge")
    m.add_argument("file", type=Path)
    m.add_argument("lang")
    m.add_argument("table", type=Path)
    c = sub.add_parser("check")
    c.add_argument("file", type=Path)
    args = ap.parse_args()

    data = json.loads(args.file.read_text(encoding="utf-8"))
    if args.cmd == "export":
        json.dump(export(data), sys.stdout, ensure_ascii=False, indent=1)
        print()
    elif args.cmd == "merge":
        table = json.loads(args.table.read_text(encoding="utf-8"))
        problems = merge(data, args.lang, table)
        if problems:
            print("\n".join(problems), file=sys.stderr)
            raise SystemExit(1)
        args.file.write_text(
            json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
        print(f"merged {len(table)} fields into {args.file} ({args.lang})")
    else:
        problems = check(data)
        print("\n".join(problems) if problems else "complete")
        raise SystemExit(1 if problems else 0)


if __name__ == "__main__":
    main()
