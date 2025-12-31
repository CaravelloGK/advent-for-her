-- Add a manual display number and a short title for the card UI
-- Run in Supabase Dashboard -> SQL Editor

ALTER TABLE public.days
ADD COLUMN IF NOT EXISTS day_number INTEGER,
ADD COLUMN IF NOT EXISTS title TEXT;

-- Backfill for existing rows: keep old behavior (id as day number)
UPDATE public.days
SET day_number = id
WHERE day_number IS NULL;

-- Make it required and unique (so ordering is deterministic)
ALTER TABLE public.days
ALTER COLUMN day_number SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'days_day_number_unique'
  ) THEN
    ALTER TABLE public.days
    ADD CONSTRAINT days_day_number_unique UNIQUE (day_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_days_day_number ON public.days(day_number);


