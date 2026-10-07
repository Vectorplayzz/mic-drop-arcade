-- The hero the player picked; shown on the leaderboard and score card. Cosmetic only.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS character TEXT NOT NULL DEFAULT 'arjun';
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_character_check;
ALTER TABLE scores ADD CONSTRAINT scores_character_check
    CHECK (character IN ('arjun', 'kabir', 'sai', 'diya', 'meera', 'zara'));
