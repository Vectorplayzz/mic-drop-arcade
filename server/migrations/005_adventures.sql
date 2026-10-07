-- Branching voice adventures: a leaderboard row can now be an adventure run. It records how
-- long the run took (ties on score go to the faster player), which ending was reached and how
-- rare it is, and which wizard narrated. An adventure may end without any puzzle, so a row may
-- have zero questions.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'quiz';
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_mode_check;
ALTER TABLE scores ADD CONSTRAINT scores_mode_check CHECK (mode IN ('quiz', 'adventure'));

ALTER TABLE scores ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_duration_check;
ALTER TABLE scores ADD CONSTRAINT scores_duration_check
    CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000);

ALTER TABLE scores ADD COLUMN IF NOT EXISTS ending_id TEXT;
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_ending_check;
ALTER TABLE scores ADD CONSTRAINT scores_ending_check
    CHECK (ending_id IS NULL OR ending_id ~ '^[a-z][a-z0-9_]{0,31}$');

ALTER TABLE scores ADD COLUMN IF NOT EXISTS ending_rank TEXT;
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_rank_check;
ALTER TABLE scores ADD CONSTRAINT scores_rank_check
    CHECK (ending_rank IS NULL OR ending_rank IN ('gold', 'silver', 'bronze'));

ALTER TABLE scores ADD COLUMN IF NOT EXISTS wizard TEXT NOT NULL DEFAULT 'sorceress';
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_wizard_check;
ALTER TABLE scores ADD CONSTRAINT scores_wizard_check
    CHECK (wizard IN ('sorceress', 'sage', 'owl', 'enchantress', 'trickster'));

ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_questions_check;
ALTER TABLE scores ADD CONSTRAINT scores_questions_check
    CHECK (questions >= 0 AND correct <= questions);

-- Twenty heroes.
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_character_check;
ALTER TABLE scores ADD CONSTRAINT scores_character_check
    CHECK (character IN ('arjun', 'kabir', 'sai', 'diya', 'meera', 'zara',
                         'rohan', 'aditya', 'imran', 'ananya', 'priya', 'sana',
                         'vikas', 'arnav', 'harpreet', 'dhruv',
                         'aisha', 'kavya', 'nila', 'tara'));

CREATE INDEX IF NOT EXISTS scores_board_idx
    ON scores (language, mode, score DESC, duration_ms ASC NULLS LAST, created_at);
CREATE INDEX IF NOT EXISTS scores_adventure_idx
    ON scores (pack_id, score DESC, duration_ms ASC NULLS LAST, created_at);
