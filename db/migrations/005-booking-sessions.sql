-- Dodaje nedostajuća trajanja; postojeće usluge i kopije u istoriji se ne brišu.
BEGIN;
UPDATE services SET is_active=false WHERE duration_minutes NOT IN (30,60);
INSERT INTO services (therapist_id,name_mne,name_en,duration_minutes,price_eur)
SELECT t.id,'Seansa ' || duration || ' min','Session ' || duration || ' min',duration,NULL
FROM therapists t CROSS JOIN (VALUES (30),(60)) AS durations(duration)
WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.therapist_id=t.id AND s.duration_minutes=duration AND s.is_active);
CREATE INDEX IF NOT EXISTS availability_by_therapist ON availability_windows (therapist_id,weekday) WHERE is_active;
CREATE INDEX IF NOT EXISTS blocks_by_therapist ON calendar_blocks (therapist_id,start_at) WHERE is_active;
INSERT INTO schema_migrations (name) VALUES ('005-booking-sessions') ON CONFLICT DO NOTHING;
COMMIT;
