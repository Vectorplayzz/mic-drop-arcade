"""Pickable player characters (pixel sprites live in the client; see client/ASSETS.md).

The id travels with the game: it is echoed in ``game_start``, signed into the score token and
stored with the leaderboard row, so the score card and leaderboard show the hero the player
actually picked. Purely cosmetic: it never affects scoring.
"""

from __future__ import annotations

# Ten boys and ten girls in mixed styles, drawn as pixel art in AICade Studio.
CHARACTERS: tuple[str, ...] = (
    "arjun",  # spiky black hair, red hoodie
    "kabir",  # round glasses, school blazer, backpack
    "sai",  # cyan headband, cricket bat
    "diya",  # long braid, yellow kurta
    "meera",  # pink bob, headphones
    "zara",  # high ponytail, green sporty outfit, book
    "rohan",  # curly hair, green kurta, denim jacket
    "aditya",  # buzz cut, basketball jersey
    "imran",  # wavy hair, denim jacket, guitar
    "ananya",  # two buns, red school uniform
    "priya",  # Kuchipudi dancer
    "sana",  # lavender hijab, sketchbook
    "vikas",  # round glasses, grey hoodie, laptop
    "arnav",  # curly hair, denim jacket, guitar
    "harpreet",  # blue patka, tracksuit, cricket bat
    "dhruv",  # spiky hair, lab coat, robot arm
    "aisha",  # lilac hijab, bomber jacket, drone remote
    "kavya",  # black bob, glasses, teal hoodie
    "nila",  # braid with jasmine, kurta and sneakers, camera
    "tara",  # blue pixie cut, leather jacket, skateboard
)
DEFAULT_CHARACTER = "arjun"


def valid_character(value: object) -> str | None:
    """Return the character id if it is one we ship, otherwise None."""
    if value is None:
        return DEFAULT_CHARACTER
    if isinstance(value, str) and value in CHARACTERS:
        return value
    return None
