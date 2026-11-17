-- Red čekanja i dodjela ostaju u istoj bazi kao rezervacije; postojeći podaci se ne mijenjaju.
BEGIN;
CREATE TABLE IF NOT EXISTS booking_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  queue_number bigserial NOT NULL UNIQUE,
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  client_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  service_id uuid NOT NULL REFERENCES services(id),
  service_name text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 240),
  price_eur numeric(10,2),
  phone text NOT NULL,
  first_date date NOT NULL,
  last_date date NOT NULL CHECK (last_date>=first_date),
  weekdays integer[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]),
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440 AND end_minute>start_minute),
  exact_time boolean NOT NULL,
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','ASSIGNED','CANCELLED','EXPIRED','UNAVAILABLE')),
  assigned_booking_id uuid UNIQUE REFERENCES booking_requests(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CHECK (end_minute-start_minute>=duration_minutes),
  CHECK (NOT exact_time OR (first_date=last_date AND end_minute-start_minute=duration_minutes)),
  CHECK ((status='ASSIGNED')=(assigned_booking_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS waitlist_order ON booking_waitlist(therapist_id,queue_number) WHERE status='WAITING';
CREATE INDEX IF NOT EXISTS waitlist_client ON booking_waitlist(client_user_id,created_at);
-- Isti formular poslije mrežne greške vraća isti rezultat i kada je seansa već dodijeljena.
ALTER TABLE booking_waitlist ADD COLUMN IF NOT EXISTS request_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_request ON booking_waitlist(client_user_id,request_id);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_no_duplicate ON booking_waitlist
  (client_user_id,therapist_id,service_id,first_date,last_date,weekdays,start_minute,end_minute,exact_time) WHERE status='WAITING';
INSERT INTO schema_migrations(name) VALUES ('011-waitlist') ON CONFLICT DO NOTHING;
COMMIT;
