import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database.service";
import type { Pool, PoolClient } from "pg";
import { photoView, type PublicTherapist } from "./directory.types";

interface DirectoryRow {
  id: string;
  public_id: string | null;
  full_name: string;
  title_mne: string;
  title_en: string;
  bio_mne: string | null;
  bio_en: string | null;
  city: string;
  address: string | null;
  profession: PublicTherapist["profession"];
  approaches_mne: string[];
  approaches_en: string[];
  languages: string[];
  education_mne: string;
  education_en: string;
  avatar_color: string;
  is_verified: boolean;
  is_active: boolean;
  accepting_clients: boolean;
  rating_total: number;
  rating_count: number;
  services: {
    id: string;
    public_id: string | null;
    name_mne: string;
    name_en: string;
    duration_minutes: number;
    price_eur: number | null;
    is_active: boolean;
    online: boolean;
  }[];
  availability: {
    id: string;
    weekday: number;
    start_minute: number;
    end_minute: number;
  }[];
  blocked: PublicTherapist["blocked"];
  date_availability: PublicTherapist["dateAvailability"];
  photos: { id: string; is_primary: boolean }[];
}

/** Čita javni katalog, usluge, dostupnost i slike iz baze, bez probnog fallback-a. */
@Injectable()
export class DirectoryService {
  /** Prima zajedničku PostgreSQL konekciju. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /** Jedan SQL snimak sprečava neslaganje profila i povezanih podataka; ne vraća privatni kontakt. */
  async list(
    connection: Pool | PoolClient = this.database.pool,
    therapistId?: string,
  ): Promise<PublicTherapist[]> {
    const result = await connection.query<DirectoryRow>(
      `SELECT t.*,
      -- Zbir, ne prosjek: ispravljeni nedolasci i otkazane seanse ne daju bodove.
      COALESCE((SELECT sum(r.score)::float8 FROM session_ratings r JOIN booking_requests b ON b.id=r.booking_id
        WHERE b.therapist_id=t.id AND b.status IN ('CONFIRMED','COMPLETED') AND b.end_at<=now()),0) AS rating_total,
      (SELECT count(*)::float8 FROM session_ratings r JOIN booking_requests b ON b.id=r.booking_id
        WHERE b.therapist_id=t.id AND b.status IN ('CONFIRMED','COMPLETED') AND b.end_at<=now()) AS rating_count,
      COALESCE((SELECT jsonb_agg(s ORDER BY s.created_at,s.id) FROM services s WHERE s.therapist_id=t.id),'[]') AS services,
      COALESCE((SELECT jsonb_agg(w ORDER BY w.weekday,w.start_minute) FROM availability_windows w WHERE w.therapist_id=t.id AND w.is_active),'[]') AS availability,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'date',d.work_date::text,'working',d.is_working,
        'start',COALESCE(d.start_minute,0),'end',COALESCE(d.end_minute,0)) ORDER BY d.work_date)
        FROM availability_dates d WHERE d.therapist_id=t.id AND d.is_active
        AND d.work_date >= (now() AT TIME ZONE 'Europe/Podgorica')::date),'[]') AS date_availability,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id::text || '-' || to_char(day,'YYYY-MM-DD'), 'date',to_char(day,'YYYY-MM-DD'),
        'start',floor(extract(epoch FROM (GREATEST(b.start_at AT TIME ZONE 'Europe/Podgorica',day)-day))/60),
        'end',ceil(extract(epoch FROM (LEAST(b.end_at AT TIME ZONE 'Europe/Podgorica',day+interval '1 day')-day))/60)))
        FROM calendar_blocks b CROSS JOIN LATERAL generate_series(date_trunc('day',b.start_at AT TIME ZONE 'Europe/Podgorica'),date_trunc('day',(b.end_at-interval '1 microsecond') AT TIME ZONE 'Europe/Podgorica'),interval '1 day') day
        WHERE b.therapist_id=t.id AND b.is_active),'[]') AS blocked,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'is_primary',p.is_primary) ORDER BY p.is_primary DESC,p.created_at,p.id) FROM therapist_photos p WHERE p.therapist_id=t.id),'[]') AS photos
      FROM therapists t LEFT JOIN users u ON u.id=t.linked_user_id WHERE t.is_active AND u.suspended_at IS NULL
      AND ($1::text IS NULL OR t.id::text=$1 OR t.public_id=$1) ORDER BY t.full_name,t.id`,
      [therapistId || null],
    );
    const therapists: PublicTherapist[] = [];
    for (const row of result.rows) {
      const initials: string[] = [];
      for (const part of row.full_name.trim().split(/\s+/).slice(0, 2))
        initials.push(part[0] || "");
      therapists.push({
        id: row.public_id || row.id,
        name: row.full_name,
        title: row.title_mne,
        titleEn: row.title_en,
        city: row.city,
        address: row.address || "",
        bio: row.bio_mne || "",
        bioEn: row.bio_en || "",
        profession: row.profession,
        approaches: row.approaches_mne,
        approachesEn: row.approaches_en,
        languages: row.languages,
        education: row.education_mne,
        educationEn: row.education_en,
        verified: row.is_verified,
        active: row.is_active,
        acceptingClients: row.accepting_clients,
        ratingTotal: row.rating_total,
        ratingCount: row.rating_count,
        color: row.avatar_color,
        initials: initials.join("").toUpperCase(),
        services: row.services.map((service) => ({
          id: service.public_id || service.id,
          name: service.name_mne,
          nameEn: service.name_en,
          duration: service.duration_minutes,
          price: service.price_eur === null ? null : Number(service.price_eur),
          active: service.is_active,
          online: service.online,
        })),
        availability: row.availability.map((window) => ({
          id: window.id,
          weekday: window.weekday,
          start: window.start_minute,
          end: window.end_minute,
        })),
        blocked: row.blocked,
        dateAvailability: row.date_availability,
        photos: row.photos.map(photoView),
      });
    }
    return therapists;
  }
}
