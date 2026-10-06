-- Initial PostgreSQL model. This migration has NOT been applied to a live database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- pgcrypto pravi UUID oznake; btree_gist omogućava zabranu preklapanja po terapeutu.

CREATE TYPE user_role AS ENUM ('CLIENT', 'THERAPIST', 'ADMIN');
CREATE TYPE booking_status AS ENUM ('REQUESTED', 'ALTERNATIVE_PROPOSED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'EXPIRED_PROVIDER', 'EXPIRED_CLIENT', 'COMPLETED', 'NO_SHOW');

-- Nalozi. FOREIGN KEY / REFERENCES povezuje red sa redom u drugoj tabeli.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  phone text,
  role user_role NOT NULL DEFAULT 'CLIENT',
  verified_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_normalized ON users (lower(email));

-- Javni profil može biti aktivan i neverifikovan. Dozvole promjene provjerava budući API.
CREATE TABLE therapists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  title_mne text NOT NULL,
  title_en text NOT NULL,
  bio_mne varchar(400),
  bio_en varchar(400),
  city text NOT NULL,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  accepting_clients boolean NOT NULL DEFAULT true,
  is_verified boolean NOT NULL DEFAULT false,
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  timezone text NOT NULL DEFAULT 'Europe/Podgorica',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Usluge. NULL cijena znači „Na upit“. Zajednički ključ sprečava tuđu uslugu u rezervaciji.
CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  name_mne text NOT NULL,
  name_en text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 240),
  price_eur numeric(10,2) CHECK (price_eur >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, therapist_id)
);

-- Sedmični sati, u minutima od ponoći. EXCLUDE sprečava preklapanje istog dana.
CREATE TABLE availability_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute integer NOT NULL CHECK (start_minute >= 0),
  end_minute integer NOT NULL CHECK (end_minute <= 1440 AND end_minute > start_minute),
  is_active boolean NOT NULL DEFAULT true,
  EXCLUDE USING gist (therapist_id WITH =, weekday WITH =, int4range(start_minute, end_minute, '[)') WITH &&) WHERE (is_active)
);

-- Odsustvo ili pauza za konkretan datum. API ih mora provjeriti pri zakazivanju.
CREATE TABLE calendar_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at > start_at),
  reason text,
  is_active boolean NOT NULL DEFAULT true
);

-- Zahtjev čuva kopiju usluge i kontakta, početak/kraj i svoje trenutno stanje.
CREATE TABLE booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  therapist_id uuid NOT NULL REFERENCES therapists(id),
  service_id uuid NOT NULL,
  service_name_snapshot text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  price_eur_snapshot numeric(10,2) CHECK (price_eur_snapshot >= 0),
  client_name_snapshot text NOT NULL,
  client_email_snapshot text NOT NULL,
  client_phone_snapshot text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at > start_at),
  status booking_status NOT NULL DEFAULT 'REQUESTED',
  state_version integer NOT NULL DEFAULT 1,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (service_id, therapist_id) REFERENCES services(id, therapist_id),
  CHECK (end_at = start_at + make_interval(mins => duration_minutes)),
  -- Adjacent appointments are allowed. Every service shares therapist occupancy.
  -- Updating A to B is one row update in a transaction; events/outbox share that transaction.
  EXCLUDE USING gist (therapist_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
    WHERE (status IN ('REQUESTED', 'ALTERNATIVE_PROPOSED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'))
);
CREATE INDEX bookings_client ON booking_requests (client_user_id, created_at DESC);
CREATE INDEX bookings_therapist_status_time ON booking_requests (therapist_id, status, start_at);

-- Istorija promjena zahtjeva. Novi status ne smije izbrisati podatak o starom statusu.
CREATE TABLE booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES booking_requests(id),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('CLIENT', 'THERAPIST', 'ADMIN', 'SYSTEM')),
  action text NOT NULL,
  previous_status booking_status,
  next_status booking_status NOT NULL,
  previous_start_at timestamptz,
  previous_end_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_history ON booking_events (booking_id, created_at);

-- Red za budući email servis. Jedinstven ključ sprečava dvostruko slanje istog događaja.
CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES booking_requests(id),
  recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  template_key text NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_unsent ON notification_outbox (scheduled_at) WHERE sent_at IS NULL;

-- Zapis admin izmjena; ne čuvati lozinke, tokene ili suvišne privatne podatke.
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Verzije dokumenata koje je korisnik prihvatio. Trenutni demo ne pravi ove zapise.
CREATE TABLE user_legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

-- No hard-deletion endpoint until export, archive retention and future-booking rules
-- are agreed. Neither changing role nor verification is exposed to public clients.
COMMIT;
