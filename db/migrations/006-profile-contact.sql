-- Klijentov grad i adresa su privatni podaci naloga, odvojeni od javne ordinacije terapeuta.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city varchar(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS address varchar(160);
INSERT INTO schema_migrations (name) VALUES ('006-profile-contact') ON CONFLICT DO NOTHING;
COMMIT;
