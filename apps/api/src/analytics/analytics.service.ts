import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database.service";
import { AuthService } from "../auth/auth.service";
import { requireBody } from "../auth/auth.validation";
import type {
  ProfileAnalytics,
  ProfileAnalyticsCounts,
} from "@terapeut/domain";

// pg vraća timestamptz kao Date, dok HTTP odgovor šalje ISO tekst.
interface AnalyticsSnapshot {
  currentBookings: ProfileAnalytics["currentBookings"];
  from: string;
  to: string;
  trackingStartedAt: Date;
  daily: ProfileAnalytics["daily"];
  uniqueVisitors: number;
  convertedVisitors: number;
  detailedTrackingStartedAt: Date;
  visitorSummary: ProfileAnalytics["visitorSummary"];
  audiences: ProfileAnalytics["audiences"];
  visitors: ProfileAnalytics["visitors"];
  clientVisitors: number;
}

/** Mjeri stvarne prikaze i čita istoriju; postojeće rezervacije nikada ne mijenja. */
@Injectable()
export class AnalyticsService {
  /** Koristi istu bazu i provjerenu JWT sesiju kao rezervacije. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Svako otvaranje broji zasebno; ista oznaka štiti samo od ponovljenog HTTP upisa. */
  async recordView(
    token: string | undefined,
    publicId: string,
    value: unknown,
    anonymousId?: string,
  ) {
    const user = token ? await this.auth.getAccount(token) : null;
    const body = requireBody(value);
    const viewId = body.viewId;
    const uuidPattern =
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    if (typeof viewId !== "string" || !uuidPattern.test(viewId))
      throw new BadRequestException("Neispravna oznaka pregleda.");
    if (!user && (!anonymousId || !uuidPattern.test(anonymousId)))
      throw new BadRequestException("Nedostaje oznaka anonimnog browsera.");
    if (!publicId || publicId.length > 100)
      throw new BadRequestException("Neispravan profil.");
    await this.auth.limitAttempts(
      `profile-view:${user?.id || anonymousId}`,
      2000,
      3600,
    );
    // Identitet i grupu određuje server, bez prihvatanja tuđeg userId-a ili uloge iz formulara.
    const result = await this.database.pool.query(
      `WITH profile AS (
         SELECT t.id,t.linked_user_id FROM therapists t LEFT JOIN users u ON u.id=t.linked_user_id
         WHERE (t.id::text=$1 OR t.public_id=$1) AND t.is_active AND u.suspended_at IS NULL
       ), saved AS (
         INSERT INTO profile_view_events(therapist_id,view_id,user_id,anonymous_id,kind)
         SELECT id,$3,$2,$4,CASE WHEN $2::uuid IS NULL THEN 'ANONYMOUS'
           WHEN linked_user_id=$2 THEN 'SELF' WHEN $5='CLIENT' THEN 'CLIENT' ELSE 'OTHER' END
         FROM profile ON CONFLICT DO NOTHING RETURNING therapist_id
       ) SELECT EXISTS(SELECT 1 FROM profile) AS available`,
      [
        publicId,
        user?.id || null,
        viewId,
        user ? null : anonymousId,
        user?.role || null,
      ],
    );
    if (!result.rows[0].available)
      throw new NotFoundException("Profil nije dostupan.");
    return { recorded: true };
  }

  /** Vraća samo agregate vlasnika sesije; period je po danima u zoni Europe/Podgorica. */
  async overview(
    token: string | undefined,
    period: string = "30",
    visitorPage: string = "1",
  ): Promise<ProfileAnalytics> {
    const user = await this.auth.getAccount(token);
    if (user.role !== "THERAPIST")
      throw new ForbiddenException("Analitika je dostupna samo terapeutu.");
    if (!["7", "30", "90"].includes(period))
      throw new BadRequestException("Izaberite period od 7, 30 ili 90 dana.");
    const days = Number(period);
    if (!/^[1-9]\d{0,5}$/.test(visitorPage))
      throw new BadRequestException("Neispravna stranica posjetilaca.");
    const page = Number(visitorPage);
    // Ne primamo therapistId sa klijenta: vlasništvo određuje isključivo povezan nalog.
    const owner = await this.database.pool.query(
      "SELECT id FROM therapists WHERE linked_user_id=$1",
      [user.id],
    );
    if (!owner.rowCount)
      throw new NotFoundException("Profil terapeuta nije pronađen.");
    const therapistId = owner.rows[0].id;
    // Jedan SQL snapshot sprečava razlike između kartica i dnevne tabele tokom novog zakazivanja.
    const result = await this.database.pool.query<AnalyticsSnapshot>(
      `WITH bounds AS (
         SELECT (now() AT TIME ZONE 'Europe/Podgorica')::date-($2::integer-1) AS first_day,
                (now() AT TIME ZONE 'Europe/Podgorica')::date AS last_day
       ), own_bookings AS (
         SELECT * FROM booking_requests WHERE therapist_id=$1
       ), events AS (
         SELECT e.* FROM booking_events e JOIN own_bookings b ON b.id=e.booking_id
       ), confirmations AS (
         SELECT b.id,LEAST(min(e.created_at) FILTER (WHERE e.next_status='CONFIRMED'),b.confirmed_at) AS at
         FROM own_bookings b LEFT JOIN events e ON e.booking_id=b.id GROUP BY b.id,b.confirmed_at
       ), all_views AS (
         SELECT *,COALESCE('user:'||user_id::text,'anonymous:'||anonymous_id::text) AS visitor_key
         FROM profile_view_events WHERE therapist_id=$1
       ), period_views AS (
         SELECT v.* FROM all_views v CROSS JOIN bounds
         WHERE viewed_at >= (first_day::timestamp AT TIME ZONE 'Europe/Podgorica')
           AND viewed_at < ((last_day+1)::timestamp AT TIME ZONE 'Europe/Podgorica')
       ), visitor_numbers AS (
         SELECT visitor_key,min(viewed_at) AS first_ever,
           row_number() OVER (ORDER BY min(viewed_at),visitor_key)::integer AS number
         FROM all_views GROUP BY visitor_key
       ), visitors AS (
         SELECT v.visitor_key,min(v.user_id::text) AS user_id,min(v.kind) AS kind,n.number,n.first_ever,
           count(*)::integer AS views,min(v.viewed_at) AS first_view,max(v.viewed_at) AS last_view,
           count(DISTINCT (v.viewed_at AT TIME ZONE 'Europe/Podgorica')::date)::integer AS active_days
         FROM period_views v JOIN visitor_numbers n USING(visitor_key)
         GROUP BY v.visitor_key,n.number,n.first_ever
       ), activity AS (
         SELECT (viewed_at AT TIME ZONE 'Europe/Podgorica')::date AS day,'views' AS kind FROM period_views
         UNION ALL SELECT (created_at AT TIME ZONE 'Europe/Podgorica')::date,'requests' FROM events WHERE action='REQUEST_CREATED'
         UNION ALL SELECT (at AT TIME ZONE 'Europe/Podgorica')::date,'confirmed' FROM confirmations WHERE at IS NOT NULL
         UNION ALL SELECT (created_at AT TIME ZONE 'Europe/Podgorica')::date,'cancelled' FROM events WHERE next_status='CANCELLED'
         UNION ALL SELECT (created_at AT TIME ZONE 'Europe/Podgorica')::date,'proposals' FROM events WHERE action='ALTERNATIVE_PROPOSED'
         UNION ALL SELECT (created_at AT TIME ZONE 'Europe/Podgorica')::date,'rescheduled' FROM events WHERE action='ACCEPT_ALTERNATIVE'
         UNION ALL SELECT (created_at AT TIME ZONE 'Europe/Podgorica')::date,'declined' FROM events WHERE action IN ('DECLINE','REJECT_ALTERNATIVE')
       ), daily AS (
         SELECT (first_day+offset_day)::text AS date,
           count(*) FILTER (WHERE kind='views')::integer AS views,
           count(*) FILTER (WHERE kind='requests')::integer AS requests,
           count(*) FILTER (WHERE kind='confirmed')::integer AS confirmed,
           count(*) FILTER (WHERE kind='cancelled')::integer AS cancelled,
           count(*) FILTER (WHERE kind='proposals')::integer AS proposals,
           count(*) FILTER (WHERE kind='rescheduled')::integer AS rescheduled,
           count(*) FILTER (WHERE kind='declined')::integer AS declined,
           (SELECT count(DISTINCT visitor_key)::integer FROM period_views WHERE (viewed_at AT TIME ZONE 'Europe/Podgorica')::date=first_day+offset_day) AS "uniqueVisitors",
           (count(*) FILTER (WHERE kind='views')-(SELECT count(DISTINCT visitor_key) FROM period_views WHERE (viewed_at AT TIME ZONE 'Europe/Podgorica')::date=first_day+offset_day))::integer AS "repeatViews",
           (SELECT count(*)::integer FROM period_views WHERE kind='CLIENT' AND (viewed_at AT TIME ZONE 'Europe/Podgorica')::date=first_day+offset_day) AS "clientViews",
           (SELECT count(*)::integer FROM period_views WHERE kind='ANONYMOUS' AND (viewed_at AT TIME ZONE 'Europe/Podgorica')::date=first_day+offset_day) AS "anonymousViews"
         FROM bounds CROSS JOIN generate_series(0,$2::integer-1) offset_day
         LEFT JOIN activity a ON a.day=first_day+offset_day GROUP BY first_day,offset_day
       ), visitor_page AS (
         SELECT number,kind,views,first_view AS "firstViewedAt",last_view AS "lastViewedAt",active_days AS "activeDays"
         FROM visitors ORDER BY views DESC,number LIMIT 50 OFFSET $3
       ), audience AS (
         SELECT k AS kind,count(DISTINCT v.visitor_key)::integer AS visitors,count(v.visitor_key)::integer AS views,
           (count(v.visitor_key)-count(DISTINCT v.visitor_key))::integer AS "repeatViews"
         FROM unnest(ARRAY['CLIENT','ANONYMOUS','OTHER','SELF']) k LEFT JOIN period_views v ON v.kind=k GROUP BY k
       ) SELECT
         -- Trenutno stanje obuhvata sve termine, nezavisno od perioda istorijskih radnji.
         -- Isteklo čekanje ne prikazujemo kao aktivno dok se serverski worker još osvježava.
         (SELECT jsonb_build_object(
           'total',count(*)::integer,
           'waiting',count(*) FILTER(WHERE status IN ('REQUESTED','ALTERNATIVE_PROPOSED') AND start_at>now())::integer,
           'awaitingTherapist',count(*) FILTER(WHERE status='REQUESTED' AND start_at>now())::integer,
           'awaitingClient',count(*) FILTER(WHERE status='ALTERNATIVE_PROPOSED' AND start_at>now())::integer,
           'confirmed',count(*) FILTER(WHERE status='CONFIRMED')::integer,
           'history',count(*) FILTER(WHERE status NOT IN ('REQUESTED','ALTERNATIVE_PROPOSED','CONFIRMED')
             OR (status IN ('REQUESTED','ALTERNATIVE_PROPOSED') AND start_at<=now()))::integer
         ) FROM own_bookings) AS "currentBookings",
         (SELECT first_day::text FROM bounds) AS "from",
         (SELECT last_day::text FROM bounds) AS "to",
         (SELECT started_at FROM profile_analytics_start) AS "trackingStartedAt",
         (SELECT detailed_started_at FROM profile_analytics_start) AS "detailedTrackingStartedAt",
         (SELECT jsonb_agg(daily ORDER BY date) FROM daily) AS daily,
         (SELECT count(*)::integer FROM visitors) AS "uniqueVisitors",
         (SELECT count(*)::integer FROM visitors WHERE kind='CLIENT') AS "clientVisitors",
         (SELECT jsonb_build_object(
           'repeatViews',COALESCE(sum(views-1),0)::integer,
           'returningVisitors',count(*) FILTER(WHERE views>1)::integer,
           'oneTimeVisitors',count(*) FILTER(WHERE views=1)::integer,
           'newVisitors',count(*) FILTER(WHERE first_ever >= ((SELECT first_day FROM bounds)::timestamp AT TIME ZONE 'Europe/Podgorica'))::integer,
           'averageViews',COALESCE(round(avg(views),2),0),
           'mostViews',COALESCE(max(views),0)::integer
         ) FROM visitors) AS "visitorSummary",
         (SELECT jsonb_agg(audience ORDER BY kind) FROM audience) AS audiences,
         COALESCE((SELECT jsonb_agg(visitor_page ORDER BY views DESC,number) FROM visitor_page),'[]') AS visitors,
         (SELECT count(*)::integer FROM visitors v WHERE EXISTS (
           SELECT 1 FROM own_bookings b JOIN events e ON e.booking_id=b.id CROSS JOIN bounds
           WHERE v.kind='CLIENT' AND b.client_user_id::text=v.user_id AND e.action='REQUEST_CREATED'
             AND e.created_at>=v.first_view
             AND e.created_at < ((last_day+1)::timestamp AT TIME ZONE 'Europe/Podgorica')
         )) AS "convertedVisitors"`,
      [therapistId, days, (page - 1) * 50],
    );
    const data = result.rows[0];
    const totals: ProfileAnalyticsCounts = {
      views: 0,
      requests: 0,
      confirmed: 0,
      cancelled: 0,
      proposals: 0,
      rescheduled: 0,
      declined: 0,
    };
    for (const day of data.daily) {
      for (const key of Object.keys(totals) as (keyof typeof totals)[])
        totals[key] += day[key];
    }
    return {
      ...data,
      trackingStartedAt: data.trackingStartedAt.toISOString(),
      detailedTrackingStartedAt: data.detailedTrackingStartedAt.toISOString(),
      visitorPage: page,
      visitorPages: Math.max(1, Math.ceil(data.uniqueVisitors / 50)),
      totals,
      conversion: data.clientVisitors
        ? Math.round((data.convertedVisitors / data.clientVisitors) * 1000) / 10
        : null,
    };
  }
}
