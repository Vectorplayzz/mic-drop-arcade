-- Maata Arcade schema v1. Nicknames only: no emails, phones, real names or IPs are stored.

CREATE TABLE IF NOT EXISTS scores (
    id          BIGSERIAL PRIMARY KEY,
    game_id     TEXT        NOT NULL UNIQUE,          -- one leaderboard row per played game
    nickname    TEXT        NOT NULL CHECK (char_length(nickname) BETWEEN 3 AND 16),
    language    TEXT        NOT NULL CHECK (language IN ('te-IN', 'hi-IN', 'hi-en')),
    pack_id     TEXT        NOT NULL CHECK (char_length(pack_id) <= 48),
    score       INTEGER     NOT NULL CHECK (score >= 0),
    max_score   INTEGER     NOT NULL CHECK (max_score > 0 AND score <= max_score),
    correct     SMALLINT    NOT NULL CHECK (correct >= 0),
    questions   SMALLINT    NOT NULL CHECK (questions > 0 AND correct <= questions),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scores_lang_score_idx ON scores (language, score DESC, created_at);
CREATE INDEX IF NOT EXISTS scores_created_idx ON scores (created_at);
