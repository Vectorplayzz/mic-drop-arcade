"""Server-authoritative scoring. Constants are game-design knobs (Devesh tunes them)."""

from __future__ import annotations

BASE_POINTS = 100
MAX_SPEED_BONUS = 50
STREAK_BONUS_STEP = 10
MAX_STREAK_BONUS = 50


def points_for(*, correct: bool, remaining_s: float, limit_s: float, streak: int) -> int:
    """``streak`` counts this answer (1 = first correct in a row)."""
    if not correct:
        return 0
    frac = max(0.0, min(1.0, remaining_s / limit_s)) if limit_s > 0 else 0.0
    speed = round(MAX_SPEED_BONUS * frac)
    streak_bonus = min(MAX_STREAK_BONUS, STREAK_BONUS_STEP * max(0, streak - 1))
    return BASE_POINTS + speed + streak_bonus


def max_score(questions: int) -> int:
    total = 0
    for i in range(1, questions + 1):
        total += points_for(correct=True, remaining_s=1.0, limit_s=1.0, streak=i)
    return total
