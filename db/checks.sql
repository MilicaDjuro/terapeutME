-- Run against the project's local PostgreSQL database. All test rows roll back.
-- BEGIN počinje provjeru; ROLLBACK na kraju uklanja sve testne izmjene.
-- DO blok pokušava nedozvoljenu rezervaciju i očekuje PostgreSQL exclusion_violation.
BEGIN;
INSERT INTO therapists (id, full_name, title_mne, title_en, city)
VALUES ('00000000-0000-4000-8000-000000000001', 'SQL test', 'Test', 'Test', 'Podgorica');
INSERT INTO services (id, therapist_id, name_mne, name_en, duration_minutes)
VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Test', 'Test', 60);
INSERT INTO booking_requests (id, therapist_id, service_id, service_name_snapshot, duration_minutes, client_name_snapshot, client_email_snapshot, client_phone_snapshot, start_at, end_at)
VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Test', 60, 'Test', 'test@example.test', '+38267000000', '2030-01-01 16:00+01', '2030-01-01 17:00+01');
DO $$
BEGIN
  BEGIN
    INSERT INTO booking_requests (therapist_id, service_id, service_name_snapshot, duration_minutes, client_name_snapshot, client_email_snapshot, client_phone_snapshot, start_at, end_at)
    VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Test', 60, 'Test 2', 'test2@example.test', '+38267000001', '2030-01-01 16:30+01', '2030-01-01 17:30+01');
    RAISE EXCEPTION 'Expected exclusion violation for overlapping pending request';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS: overlapping pending request rejected';
  END;
END $$;
-- Exactly adjacent is allowed.
INSERT INTO booking_requests (id, therapist_id, service_id, service_name_snapshot, duration_minutes, client_name_snapshot, client_email_snapshot, client_phone_snapshot, start_at, end_at)
VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Test', 60, 'Test', 'test@example.test', '+38267000000', '2030-01-01 17:00+01', '2030-01-01 18:00+01');
-- Propose B by replacing A's interval in the same row.
UPDATE booking_requests SET start_at = '2030-01-01 18:00+01', end_at = '2030-01-01 19:00+01', status = 'ALTERNATIVE_PROPOSED'
WHERE id = '00000000-0000-4000-8000-000000000003';
-- A is now reusable; the original booking remains in history.
INSERT INTO booking_requests (therapist_id, service_id, service_name_snapshot, duration_minutes, client_name_snapshot, client_email_snapshot, client_phone_snapshot, start_at, end_at)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Test', 60, 'Test', 'test@example.test', '+38267000000', '2030-01-01 16:00+01', '2030-01-01 17:00+01');
DO $$
BEGIN
  BEGIN
    UPDATE booking_requests SET start_at = '2030-01-01 17:30+01', end_at = '2030-01-01 18:30+01'
    WHERE id = '00000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'Expected exclusion violation for unavailable alternative';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS: unavailable alternative rejected';
  END;
  IF (SELECT start_at FROM booking_requests WHERE id = '00000000-0000-4000-8000-000000000003') <> '2030-01-01 18:00+01'::timestamptz THEN
    RAISE EXCEPTION 'Original interval was not preserved';
  END IF;
  RAISE NOTICE 'PASS: failed alternative preserves current interval';
END $$;
UPDATE booking_requests SET status = 'CANCELLED' WHERE id = '00000000-0000-4000-8000-000000000004';
-- Cancellation releases the interval even though the request row still exists.
INSERT INTO booking_requests (therapist_id, service_id, service_name_snapshot, duration_minutes, client_name_snapshot, client_email_snapshot, client_phone_snapshot, start_at, end_at)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Test', 60, 'Test', 'test@example.test', '+38267000000', '2030-01-01 17:00+01', '2030-01-01 18:00+01');
ROLLBACK;
