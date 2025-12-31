-- Добавление колонки reward_opened_at в таблицу solves
-- Выполни это ПЕРВЫМ, если колонка ещё не существует

ALTER TABLE public.solves
ADD COLUMN IF NOT EXISTS reward_opened_at timestamptz;

-- Проверка, что колонка добавлена
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'solves'
  AND column_name = 'reward_opened_at';




