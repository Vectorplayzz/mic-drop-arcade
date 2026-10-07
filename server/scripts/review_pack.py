"""Human review of a draft pack. Nothing Evon writes reaches players without this step.

    python scripts/review_pack.py packs/drafts/te-science-01.json --reviewer "G Nagarjuna"

For each question: [k]eep, [d]rop, edit [a]nswers, edit [p]rompt, edit display [s]howing,
or [q]uit without saving. Approved packs are written to packs/<id>.json with the reviewer's
name and date, which is what the server requires before it will load a pack.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.game.packs import Pack, Question, parse_pack


def ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except EOFError:
        return "q"


def review(pack: Pack) -> list[Question] | None:
    kept: list[Question] = []
    for i, q in enumerate(pack.questions, 1):
        while True:
            print(f"\n[{i}/{len(pack.questions)}] ({q.kind})  {q.prompt}")
            print(f"   answers: {' | '.join(q.answers)}")
            print(f"   display: {q.display_answer}")
            if q.explanation:
                print(f"   why:     {q.explanation}")
            choice = ask("   [k]eep [d]rop [a]nswers [p]rompt [s]how [q]uit > ").lower()
            data = q.model_dump()
            if choice == "k":
                kept.append(q)
                break
            if choice == "d":
                break
            if choice == "q":
                return None
            try:
                if choice == "a":
                    data["answers"] = [
                        a.strip() for a in ask("   answers (| separated): ").split("|") if a.strip()
                    ]
                elif choice == "p":
                    data["prompt"] = ask("   prompt: ")
                elif choice == "s":
                    data["display_answer"] = ask("   display: ")
                q = Question.model_validate(data)
            except ValueError as exc:
                print(f"   ! not valid: {exc}")
    return kept


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("draft", type=Path)
    p.add_argument("--reviewer", required=True)
    args = p.parse_args()

    pack = parse_pack(args.draft.read_bytes())
    kept = review(pack)
    if kept is None:
        print("Quit without saving.")
        return 1
    if len(kept) < 5:
        print(f"Only {len(kept)} questions kept; a pack needs at least 5. Not saved.")
        return 1
    final = Pack.model_validate(
        {
            **pack.model_dump(by_alias=True, mode="json"),
            "questions": [q.model_dump() for q in kept],
            "reviewed_by": args.reviewer,
            "reviewed_at": date.today().isoformat(),
        }
    )
    out = Path(__file__).resolve().parent.parent / "packs" / f"{final.id}.json"
    out.write_text(
        json.dumps(
            final.model_dump(by_alias=True, exclude_none=True, mode="json"),
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nApproved {len(kept)} questions -> {out}")
    print("Next: python scripts/prerender_audio.py  (renders the new lines once)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
