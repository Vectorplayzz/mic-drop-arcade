-- Adds Tenglish (te-en) and English (en-IN) as game languages.
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_language_check;
ALTER TABLE scores ADD CONSTRAINT scores_language_check
    CHECK (language IN ('te-IN', 'hi-IN', 'hi-en', 'te-en', 'en-IN'));
