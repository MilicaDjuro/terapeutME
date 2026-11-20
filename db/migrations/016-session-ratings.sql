-- Jedna seansa ima jednu ocjenu; zbir se računa iz važećih završenih seansi.
BEGIN;
CREATE TABLE session_ratings (
  booking_id uuid PRIMARY KEY REFERENCES booking_requests(id),
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (name) VALUES ('016-session-ratings');
COMMIT;
