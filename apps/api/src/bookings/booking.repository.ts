import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { Booking } from "@terapeut/domain";
import { DatabaseService } from "../database.service";

export interface StoredBooking extends Booking {
  clientUserId: string | null;
  internalTherapistId: string;
  therapistName: string;
  rating: number | null;
  canRate: boolean;
}

/** Čita rezervacije i čuva događaje; dozvole provjerava BookingService prije poziva. */
@Injectable()
export class BookingRepository {
  /** Koristi zajednički pool; za atomske promjene dobija jednu transakcijsku konekciju. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /** Čita kopije usluge i istoriju; javni kalendar iz ovih podataka vraća samo zauzetost. */
  async list(
    connection: Pool | PoolClient = this.database.pool,
    therapistId?: string,
    clientUserId?: string,
  ): Promise<StoredBooking[]> {
    const result = await connection.query<StoredBooking>(
      `
      SELECT b.id,COALESCE(t.public_id,t.id::text) AS "therapistId",t.id AS "internalTherapistId",t.full_name AS "therapistName",
        COALESCE(s.public_id,s.id::text) AS "serviceId",b.client_user_id AS "clientUserId",
        b.service_name_snapshot AS "serviceName",b.service_name_snapshot AS "serviceNameEn",
        b.duration_minutes AS duration,b.price_eur_snapshot::float8 AS price,
        to_char(b.start_at AT TIME ZONE 'Europe/Podgorica','YYYY-MM-DD') AS date,
        (extract(hour FROM b.start_at AT TIME ZONE 'Europe/Podgorica')*60+extract(minute FROM b.start_at AT TIME ZONE 'Europe/Podgorica'))::int AS start,
        (extract(hour FROM b.start_at AT TIME ZONE 'Europe/Podgorica')*60+extract(minute FROM b.start_at AT TIME ZONE 'Europe/Podgorica'))::int+b.duration_minutes AS "end",
        b.client_name_snapshot AS "clientName",b.client_email_snapshot AS "clientEmail",b.client_phone_snapshot AS "clientPhone",
        b.status,b.created_at AS "createdAt",
        CASE WHEN b.client_user_id::text=$2 THEN (SELECT r.score FROM session_ratings r WHERE r.booking_id=b.id) ELSE NULL END AS rating,
        COALESCE(b.client_user_id::text=$2 AND b.status IN ('CONFIRMED','COMPLETED') AND b.end_at<=now()
          AND NOT EXISTS(SELECT 1 FROM session_ratings r WHERE r.booking_id=b.id),false) AS "canRate",
        CASE WHEN bs.id IS NULL THEN NULL ELSE jsonb_build_object('id',bs.id,'intervalDays',bs.interval_days,
          'originalDate',to_char(b.occurrence_date,'YYYY-MM-DD'),'originalStart',bs.start_minute,'active',bs.is_active) END AS series,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('at',e.created_at,'actor',lower(e.actor_role),'action',e.action,'from',e.previous_status,'to',e.next_status,'reason',e.reason,
          'previousDate',to_char(e.previous_start_at AT TIME ZONE 'Europe/Podgorica','YYYY-MM-DD'),
          'previousStart',(extract(hour FROM e.previous_start_at AT TIME ZONE 'Europe/Podgorica')*60+extract(minute FROM e.previous_start_at AT TIME ZONE 'Europe/Podgorica'))::int)
          ORDER BY e.created_at,e.id) FROM booking_events e WHERE e.booking_id=b.id),'[]') AS events
      FROM booking_requests b JOIN therapists t ON t.id=b.therapist_id JOIN services s ON s.id=b.service_id
      LEFT JOIN booking_series bs ON bs.id=b.series_id
      WHERE ($1::text IS NULL OR t.id::text=$1) AND ($2::text IS NULL OR b.client_user_id::text=$2)
      ORDER BY b.start_at,b.id`,
      [therapistId || null, clientUserId || null],
    );
    return result.rows;
  }

  /** Čuva novi događaj u istoj transakciji kao zahtjev; kod predloga bilježi prethodni termin. */
  async recordEvent(
    client: PoolClient,
    booking: Booking,
    userId: string | null,
    previous?: Booking,
  ) {
    const event = booking.events[booking.events.length - 1];
    await client.query(
      `INSERT INTO booking_events (booking_id,actor_user_id,actor_role,action,previous_status,next_status,previous_start_at,previous_end_at,reason)
      VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7::date IS NULL THEN NULL ELSE ($7::date+$8*interval '1 minute') AT TIME ZONE 'Europe/Podgorica' END,
      CASE WHEN $7::date IS NULL THEN NULL ELSE ($7::date+$9*interval '1 minute') AT TIME ZONE 'Europe/Podgorica' END,$10)`,
      [
        booking.id,
        userId,
        event.actor.toUpperCase(),
        event.action,
        event.from,
        event.to,
        previous?.date || null,
        previous?.start ?? null,
        previous?.end ?? null,
        event.reason || null,
      ],
    );
  }

  /** Atomski označava zahtjeve bez odgovora i dodaje istoriju; ne zavisi od otvorenog browsera. */
  async expireWaiting() {
    await this.database.pool.query(`WITH waiting AS (
      SELECT id,status FROM booking_requests WHERE status IN ('REQUESTED','ALTERNATIVE_PROPOSED') AND start_at<=now() FOR UPDATE SKIP LOCKED
    ), expired AS (
      UPDATE booking_requests b SET status=CASE WHEN w.status='REQUESTED' THEN 'EXPIRED_PROVIDER'::booking_status ELSE 'EXPIRED_CLIENT'::booking_status END,
        updated_at=now(),state_version=state_version+1 FROM waiting w WHERE b.id=w.id RETURNING b.id,w.status AS previous_status,b.status
    ) INSERT INTO booking_events (booking_id,actor_role,action,previous_status,next_status)
      SELECT id,'SYSTEM','UNANSWERED_AT_START',previous_status,status FROM expired`);
  }
}
