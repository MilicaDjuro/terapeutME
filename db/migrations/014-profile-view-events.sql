-- Svako otvaranje je događaj; ponovljeni HTTP upis istog događaja nije novi klik.
BEGIN;
ALTER TABLE profile_analytics_start ADD COLUMN IF NOT EXISTS detailed_started_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS profile_view_events (
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  view_id uuid NOT NULL,
  user_id uuid REFERENCES users(id),
  anonymous_id uuid,
  kind text NOT NULL CHECK (kind IN ('CLIENT','ANONYMOUS','OTHER','SELF')),
  viewed_at timestamptz NOT NULL DEFAULT now(),
  legacy_daily boolean NOT NULL DEFAULT false,
  PRIMARY KEY (therapist_id,view_id),
  CHECK ((kind='ANONYMOUS' AND anonymous_id IS NOT NULL AND user_id IS NULL)
    OR (kind<>'ANONYMOUS' AND user_id IS NOT NULL AND anonymous_id IS NULL))
);
CREATE INDEX IF NOT EXISTS profile_events_by_date ON profile_view_events(therapist_id,viewed_at);
CREATE UNIQUE INDEX IF NOT EXISTS profile_events_legacy ON profile_view_events(therapist_id,user_id,viewed_at) WHERE legacy_daily;
-- Stari dnevni minimum ostaje; ranije nepoznate ponovljene klikove ne izmišljamo.
INSERT INTO profile_view_events(therapist_id,view_id,user_id,kind,viewed_at,legacy_daily)
SELECT therapist_id,gen_random_uuid(),client_user_id,'CLIENT',viewed_at,true FROM profile_views
ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(name) VALUES ('014-profile-view-events') ON CONFLICT DO NOTHING;
COMMIT;
