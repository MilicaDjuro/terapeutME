-- Jedan pregled prijavljenog klijenta po profilu i lokalnom danu, bez IP adresa.
BEGIN;
CREATE TABLE IF NOT EXISTS profile_analytics_start (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO profile_analytics_start(singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS profile_views (
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  client_user_id uuid NOT NULL REFERENCES users(id),
  viewed_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Podgorica')::date,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (therapist_id, client_user_id, viewed_on)
);
CREATE INDEX IF NOT EXISTS profile_views_by_date ON profile_views(therapist_id, viewed_on);
INSERT INTO schema_migrations(name) VALUES ('013-profile-analytics') ON CONFLICT DO NOTHING;
COMMIT;
