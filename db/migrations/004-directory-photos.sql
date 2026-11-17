-- Novi javni podaci čuvaju stare URL-ove i demo istoriju; postojeći profili ostaju sačuvani.
BEGIN;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS public_id text UNIQUE;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS profession text NOT NULL DEFAULT 'psychotherapist' CHECK (profession IN ('psychologist','psychotherapist','psychiatrist'));
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS approaches_mne text[] NOT NULL DEFAULT '{}';
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS approaches_en text[] NOT NULL DEFAULT '{}';
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}';
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS education_mne text NOT NULL DEFAULT '';
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS education_en text NOT NULL DEFAULT '';
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS avatar_color text NOT NULL DEFAULT 'sage';
ALTER TABLE services ADD COLUMN IF NOT EXISTS public_id text UNIQUE;
UPDATE therapists SET profession = CASE WHEN title_mne ILIKE '%psihijatr%' THEN 'psychiatrist' WHEN title_mne ILIKE '%psiholog%' OR title_mne ILIKE '%psihološ%' THEN 'psychologist' ELSE profession END WHERE public_id IS NULL;
CREATE TABLE IF NOT EXISTS therapist_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  image_data bytea NOT NULL CHECK (octet_length(image_data) <= 5242880),
  width integer NOT NULL CHECK (width > 0 AND width <= 1600),
  height integer NOT NULL CHECK (height > 0 AND height <= 1600),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS therapist_one_primary_photo ON therapist_photos (therapist_id) WHERE is_primary;
INSERT INTO schema_migrations (name) VALUES ('004-directory-photos') ON CONFLICT DO NOTHING;
COMMIT;
