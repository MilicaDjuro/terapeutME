BEGIN;
-- Čekaonica čuva samo prisustvo i dogovor o početku, bez veze sa video servisom.
CREATE TABLE IF NOT EXISTS online_session_lobbies (
  booking_id uuid NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  booking_version integer NOT NULL,
  generation uuid NOT NULL DEFAULT gen_random_uuid(),
  therapist_presence_id uuid,
  therapist_ready_at timestamptz,
  client_presence_id uuid,
  client_ready_at timestamptz,
  started_at timestamptz,
  PRIMARY KEY (booking_id,booking_version)
);

-- Novi početak razgovora dobija novu sobu; stare oznake i istorija ostaju sačuvani.
ALTER TABLE online_session_rooms ADD COLUMN IF NOT EXISTS lobby_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE online_session_rooms DROP CONSTRAINT IF EXISTS online_session_rooms_booking_id_booking_version_key;
CREATE UNIQUE INDEX IF NOT EXISTS online_room_lobby ON online_session_rooms(booking_id,booking_version,lobby_id);
UPDATE online_session_rooms SET revoked_at=COALESCE(revoked_at,now()) WHERE closed_at IS NULL;

-- Izlazak ili istek prisustva opoziva tekuću sobu u istoj transakciji kao promjenu lobija.
CREATE OR REPLACE FUNCTION revoke_stopped_lobby_rooms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.generation<>OLD.generation OR (OLD.started_at IS NOT NULL AND NEW.started_at IS NULL) THEN
    UPDATE online_session_rooms SET revoked_at=COALESCE(revoked_at,now())
    WHERE booking_id=OLD.booking_id AND booking_version=OLD.booking_version AND lobby_id=OLD.generation AND closed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lobby_room_revocation ON online_session_lobbies;
CREATE TRIGGER lobby_room_revocation AFTER UPDATE ON online_session_lobbies
FOR EACH ROW EXECUTE FUNCTION revoke_stopped_lobby_rooms();
INSERT INTO schema_migrations(name) VALUES ('017-online-lobby') ON CONFLICT DO NOTHING;
COMMIT;
