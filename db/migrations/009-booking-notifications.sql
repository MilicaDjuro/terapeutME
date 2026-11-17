-- Dopunjava postojeći trajni red; ne pravi poruke za ranije rezervacije.
BEGIN;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS expected_version integer;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS skipped_at timestamptz;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS skipped_reason text;
CREATE INDEX IF NOT EXISTS outbox_booking_email_pending
  ON notification_outbox (scheduled_at,created_at) WHERE sent_at IS NULL AND skipped_at IS NULL;
INSERT INTO schema_migrations (name) VALUES ('009-booking-notifications') ON CONFLICT DO NOTHING;
COMMIT;
