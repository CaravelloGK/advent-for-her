-- Example day for puzzle_type = 'chronological_images'
-- User must arrange 4 photos in chronological order (left-to-right).
--
-- Storage:
-- - Put the 4 images in Supabase Storage bucket (you already use `rewards` bucket for signed URLs).
-- - Use paths like: 'rewards/chrono/day6/01.jpg' OR a full storage URL OR just the filename (if your edge fn expects that).
--
-- IMPORTANT:
-- - `puzzle_data.images` order defines the imageId values [0..3] used by the UI.
-- - `correct_answer` MUST be a JSON array of imageIds in the correct order, e.g. [2,0,3,1]
-- - `max_attempts` should be 3 (per your rules).

INSERT INTO public.days (
  id,
  unlock_at,
  puzzle_type,
  puzzle_data,
  reward_type,
  reward_data,
  correct_answer,
  max_attempts
)
VALUES (
  6,
  DATE '2026-01-05',
  'chronological_images',
  jsonb_build_object(
    'question', 'Расположи фотографии в хронологическом порядке',
    'images', jsonb_build_array(
      'rewards/chrono/day6/a.jpg',
      'rewards/chrono/day6/b.jpg',
      'rewards/chrono/day6/c.jpg',
      'rewards/chrono/day6/d.jpg'
    )
  ),
  'text',
  '{"text": "Кайф! Ты собрала хронологию 🎉"}'::jsonb,
  '[2,0,3,1]',
  3
)
ON CONFLICT (id) DO UPDATE SET
  unlock_at = EXCLUDED.unlock_at,
  puzzle_type = EXCLUDED.puzzle_type,
  puzzle_data = EXCLUDED.puzzle_data,
  reward_type = EXCLUDED.reward_type,
  reward_data = EXCLUDED.reward_data,
  correct_answer = EXCLUDED.correct_answer,
  max_attempts = EXCLUDED.max_attempts;



