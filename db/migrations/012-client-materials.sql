-- Privatni zadaci i PDF prilozi pripadaju jednom terapeutu i jednom klijentu.
BEGIN;
CREATE TABLE IF NOT EXISTS client_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  client_user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('HOMEWORK','EXERCISE','JOURNAL','RESOURCE')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions)<=10000),
  resource_url text CHECK (char_length(resource_url)<=2000),
  due_date date,
  file_name text,
  file_data bytea,
  file_size integer,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK ((file_data IS NULL AND file_name IS NULL AND file_size IS NULL) OR
    (file_data IS NOT NULL AND file_name IS NOT NULL AND file_size=octet_length(file_data) AND file_size BETWEEN 1 AND 5242880)),
  CHECK (char_length(instructions)>0 OR resource_url IS NOT NULL OR file_data IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS materials_client ON client_materials(client_user_id,created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS materials_therapist ON client_materials(therapist_id,client_user_id,created_at DESC) WHERE archived_at IS NULL;
INSERT INTO schema_migrations(name) VALUES ('012-client-materials') ON CONFLICT DO NOTHING;
COMMIT;
