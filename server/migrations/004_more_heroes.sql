-- Six more pickable heroes (twelve in all).
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_character_check;
ALTER TABLE scores ADD CONSTRAINT scores_character_check
    CHECK (character IN ('arjun', 'kabir', 'sai', 'diya', 'meera', 'zara',
                         'rohan', 'aditya', 'imran', 'ananya', 'priya', 'sana'));
