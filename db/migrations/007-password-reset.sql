-- Baza čuva samo hash JWT linka: brisanje zapisa poništava link i prije isteka potpisa.
BEGIN;
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_user ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS password_reset_expiry ON password_reset_tokens (expires_at);
INSERT INTO schema_migrations (name) VALUES ('007-password-reset') ON CONFLICT DO NOTHING;
COMMIT;
