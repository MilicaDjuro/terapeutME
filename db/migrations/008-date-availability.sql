-- Radno vrijeme konkretnog datuma zamjenjuje sedmicni raspored samo za taj datum.
BEGIN;
CREATE TABLE IF NOT EXISTS availability_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  work_date date NOT NULL,
  is_working boolean NOT NULL DEFAULT true,
  start_minute integer,
  end_minute integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (is_working AND start_minute IS NOT NULL AND end_minute IS NOT NULL
      AND start_minute >= 0 AND start_minute < end_minute AND end_minute <= 1440)
    OR (NOT is_working AND start_minute IS NULL AND end_minute IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS availability_dates_one_active_day
  ON availability_dates (therapist_id,work_date) WHERE is_active;
INSERT INTO schema_migrations (name) VALUES ('008-date-availability') ON CONFLICT DO NOTHING;
COMMIT;
