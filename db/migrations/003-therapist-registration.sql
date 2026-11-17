-- Čuva podatke novog terapeuta do email potvrde; postojeće naloge ne mijenja.
BEGIN;
ALTER TABLE registration_challenges
  ADD COLUMN IF NOT EXISTS registration_role user_role NOT NULL DEFAULT 'CLIENT'
  CHECK (registration_role IN ('CLIENT', 'THERAPIST'));
CREATE TABLE IF NOT EXISTS therapist_registration_details (
  challenge_id uuid PRIMARY KEY REFERENCES registration_challenges(id) ON DELETE CASCADE,
  title text NOT NULL,
  biography varchar(400) NOT NULL,
  city text NOT NULL,
  address text,
  phone text NOT NULL,
  service_name text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 240),
  price_eur numeric(10,2) CHECK (price_eur >= 0)
);
INSERT INTO schema_migrations (name) VALUES ('003-therapist-registration') ON CONFLICT DO NOTHING;
COMMIT;
