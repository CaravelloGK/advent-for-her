-- Lockouts after exhausting attempts
-- Creates a history table; latest row per day defines the current lockout window.

CREATE TABLE IF NOT EXISTS public.attempt_locks (
  id bigserial PRIMARY KEY,
  day_id int NOT NULL REFERENCES public.days(id) ON DELETE CASCADE,
  locked_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attempt_locks_day_id_locked_until_idx
  ON public.attempt_locks (day_id, locked_until DESC);


