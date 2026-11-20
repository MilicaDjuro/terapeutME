-- Bilješka pripada jednom terapeutu i klijentu; ne ulazi u materijale vidljive klijentu.
BEGIN;
CREATE TABLE IF NOT EXISTS therapist_client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  client_user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 20000),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS therapist_notes_by_client
  ON therapist_client_notes(therapist_id,client_user_id,created_at DESC,id)
  WHERE archived_at IS NULL;
INSERT INTO schema_migrations(name) VALUES ('015-therapist-notes') ON CONFLICT DO NOTHING;
COMMIT;
