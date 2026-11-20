BEGIN;
-- Stare usluge i rezervacije ostaju uživo; izmjena ponude ne mijenja dogovoreni način rada.
ALTER TABLE services ADD COLUMN IF NOT EXISTS online boolean NOT NULL DEFAULT false;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS online boolean NOT NULL DEFAULT false;
ALTER TABLE booking_waitlist ADD COLUMN IF NOT EXISTS online boolean NOT NULL DEFAULT false;
ALTER TABLE therapist_registration_details ADD COLUMN IF NOT EXISTS online boolean NOT NULL DEFAULT false;

-- Čuvamo tehničku oznaku sobe, bez pristupnih tokena, snimaka ili transkripata.
CREATE TABLE IF NOT EXISTS online_session_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES booking_requests(id),
  booking_version integer NOT NULL,
  provider text NOT NULL DEFAULT 'daily' CHECK (provider='daily'),
  room_name text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(booking_id,booking_version)
);
CREATE INDEX IF NOT EXISTS online_rooms_cleanup ON online_session_rooms(expires_at) WHERE closed_at IS NULL;

-- Promjena dogovora poništava sobu u istoj transakciji; radnik zatim izbacuje učesnike i briše sobu.
CREATE OR REPLACE FUNCTION revoke_changed_online_rooms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state_version<>OLD.state_version OR NEW.status<>OLD.status OR NEW.start_at<>OLD.start_at
     OR NEW.end_at<>OLD.end_at OR NEW.online<>OLD.online OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id THEN
    UPDATE online_session_rooms SET revoked_at=COALESCE(revoked_at,now()) WHERE booking_id=NEW.id AND closed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS booking_online_room_revocation ON booking_requests;
CREATE TRIGGER booking_online_room_revocation AFTER UPDATE ON booking_requests
FOR EACH ROW EXECUTE FUNCTION revoke_changed_online_rooms();
INSERT INTO schema_migrations(name) VALUES ('015-online-sessions') ON CONFLICT DO NOTHING;
COMMIT;
