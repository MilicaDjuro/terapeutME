-- Pravilo ponavljanja je trajno; pojedinačne rezervacije i njihova istorija ostaju zasebni zapisi.
BEGIN;
CREATE TABLE IF NOT EXISTS booking_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  client_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  anchor_booking_id uuid NOT NULL UNIQUE REFERENCES booking_requests(id),
  interval_days integer NOT NULL CHECK (interval_days IN (7,14)),
  first_date date NOT NULL,
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  next_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz
);
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES booking_series(id);
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS occurrence_date date;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='booking_recurring_date_pair' AND conrelid='booking_requests'::regclass) THEN
    ALTER TABLE booking_requests ADD CONSTRAINT booking_recurring_date_pair CHECK ((series_id IS NULL)=(occurrence_date IS NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS booking_series_occurrence ON booking_requests(series_id,occurrence_date);
CREATE INDEX IF NOT EXISTS booking_series_due ON booking_series(next_date) WHERE is_active;
-- Neuspjeli budući datum mora biti vidljiv vlasnicima; ne prikazujemo ga kao zakazanu seansu.
CREATE TABLE IF NOT EXISTS booking_series_issues (
  series_id uuid NOT NULL REFERENCES booking_series(id),
  occurrence_date date NOT NULL,
  reason text NOT NULL,
  resolved_at timestamptz,
  PRIMARY KEY(series_id,occurrence_date)
);
INSERT INTO schema_migrations(name) VALUES ('010-recurring-bookings') ON CONFLICT DO NOTHING;
COMMIT;
