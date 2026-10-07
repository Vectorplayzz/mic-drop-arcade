"""Operator CLI. Deliberately not an HTTP endpoint: it runs inside the container.

docker compose exec api python -m app.admin status
docker compose exec api python -m app.admin killswitch on|off
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from redis.asyncio import Redis

from app.budget import CreditBudget
from app.config import get_settings
from app.deps import Slots


async def _main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.admin")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="credit usage, kill switch and active games")
    ks = sub.add_parser("killswitch", help="stop or resume all new rounds")
    ks.add_argument("state", choices=["on", "off"])
    args = parser.parse_args(argv)

    s = get_settings()
    redis = Redis.from_url(s.redis_url)
    budget = CreditBudget(
        redis,
        daily_budget=s.daily_credit_budget,
        credits_total=s.credits_total,
        credits_per_stt_minute=s.credits_per_stt_minute,
        credits_per_1k_tts_chars=s.credits_per_1k_tts_chars,
        env_kill_switch=s.kill_switch,
    )
    try:
        if args.cmd == "killswitch":
            await budget.set_kill_switch(args.state == "on")
        st = await budget.status()
        active = await Slots(redis, s.max_concurrent_games).active_games()
        print(
            json.dumps(
                {
                    "open": st.open,
                    "reason": st.reason,
                    "spent_today": round(st.spent_today, 2),
                    "daily_budget": st.daily_budget,
                    "spent_total": round(st.spent_total, 2),
                    "credits_total": st.credits_total,
                    "active_games": active,
                },
                indent=2,
            )
        )
    finally:
        await redis.aclose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main(sys.argv[1:])))
