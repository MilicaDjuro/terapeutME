import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DatabaseService } from "../database.service";
import { AuthService } from "../auth/auth.service";
import type { AccountUser } from "../auth/auth.types";
import { configuredVideoProvider } from "../config";
import { DailyService } from "./daily.service";

interface SessionBooking {
  id: string;
  online: boolean;
  status: string;
  state_version: number;
  start_at: Date;
  end_at: Date;
  client_user_id: string | null;
  therapist_user_id: string | null;
  service_name: string;
  therapist_name: string;
  accounts_available: boolean;
}
interface SessionRoom {
  id: string;
  room_name: string;
  booking_version: number;
  revoked_at: Date | null;
  closed_at: Date | null;
}

/** Provjerava stvarnu rezervaciju prije svakog pristupa; Daily dobija samo tehničke identitete. */
@Injectable()
export class OnlineSessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OnlineSessionsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private cleanup: Promise<void> | null = null;

  /** Koristi postojeću JWT prijavu i bazu; provider je izdvojen zbog moguće zamjene AWS-om. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DailyService) private readonly daily: DailyService,
  ) {}

  /** Otkazane i promijenjene termine čistimo i kada korisnik zatvori browser. */
  onModuleInit() {
    if (configuredVideoProvider() !== "daily") return;
    this.timer = setInterval(() => {
      void this.closeRevokedRooms();
    }, 15000);
    this.timer.unref();
    void this.closeRevokedRooms();
  }

  /** Zaustavlja timer i čeka već započeto zatvaranje prije gašenja DB pool-a. */
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.cleanup;
  }

  /** Čita rezervaciju samo njenim učesnicima; ADMIN i drugi terapeuti nemaju ulazak u seansu. */
  private async booking(
    user: AccountUser,
    bookingId: string,
    connection: Pool | PoolClient = this.database.pool,
  ): Promise<SessionBooking> {
    if (user.role !== "CLIENT" && user.role !== "THERAPIST")
      throw new ForbiddenException("Poziv je dostupan samo učesnicima seanse.");
    const result = await connection.query<SessionBooking>(
      `SELECT b.id,b.online,b.status,b.state_version,b.start_at,b.end_at,b.client_user_id,
       t.linked_user_id AS therapist_user_id,b.service_name_snapshot AS service_name,t.full_name AS therapist_name,
       (t.is_active AND tu.role='THERAPIST' AND tu.verified_at IS NOT NULL AND tu.suspended_at IS NULL
       AND cu.role='CLIENT' AND cu.verified_at IS NOT NULL AND cu.suspended_at IS NULL) AS accounts_available
       FROM booking_requests b JOIN therapists t ON t.id=b.therapist_id
       LEFT JOIN users tu ON tu.id=t.linked_user_id LEFT JOIN users cu ON cu.id=b.client_user_id
       WHERE b.id::text=$1 AND (($2='CLIENT' AND b.client_user_id=$3) OR ($2='THERAPIST' AND t.linked_user_id=$3))`,
      [bookingId, user.role, user.id],
    );
    if (!result.rows[0]) throw new NotFoundException("Seansa nije pronađena.");
    return result.rows[0];
  }

  /** Izračunava prozor poziva na serveru: 10 minuta prije do 10 minuta poslije rezervisanog vremena. */
  private details(booking: SessionBooking, user: AccountUser) {
    const opensAt = new Date(booking.start_at.getTime() - 10 * 60000);
    const closesAt = new Date(booking.end_at.getTime() + 10 * 60000);
    const provider = configuredVideoProvider();
    let reason = "";
    if (!booking.online) reason = "Ova seansa je zakazana uživo.";
    else if (booking.status !== "CONFIRMED")
      reason = "Poziv je dostupan samo za potvrđen termin.";
    else if (!booking.accounts_available)
      reason = "Nalog jednog od učesnika nije dostupan.";
    else if (provider === "disabled")
      reason = "Online pozivi još nijesu uključeni. Kontaktirajte terapeuta.";
    else if (Date.now() < opensAt.getTime())
      reason = "Ulazak se otvara 10 minuta prije termina.";
    else if (Date.now() >= closesAt.getTime())
      reason = "Vrijeme za ovu online seansu je završeno.";
    return {
      bookingId: booking.id,
      serviceName: booking.service_name,
      therapistName: booking.therapist_name,
      role: user.role,
      online: booking.online,
      bookingStatus: booking.status,
      startAt: booking.start_at.toISOString(),
      endAt: booking.end_at.toISOString(),
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      configured: provider === "daily",
      canJoin: reason === "",
      reason,
    };
  }

  /** Vraća podatke za pripremu kamere; čitanje ne pravi sobu i ne troši video minute. */
  async info(token: string | undefined, bookingId: string) {
    const user = await this.auth.getAccount(token);
    return this.details(await this.booking(user, bookingId), user);
  }

  /** Jedna soba ima samo jedan mrežni upis/brisanje odjednom; nema otvorene SQL transakcije tokom čekanja. */
  private async lockRoom(roomId: string): Promise<PoolClient | null> {
    const client = await this.database.pool.connect();
    try {
      const result = await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [`online-room:${roomId}`],
      );
      if (result.rows[0].locked) return client;
      client.release();
      return null;
    } catch (failure) {
      client.release();
      throw failure;
    }
  }

  /** Session lock se obavezno uklanja prije vraćanja konekcije u pool. */
  private async unlockRoom(client: PoolClient, roomId: string): Promise<void> {
    let failure: Error | undefined;
    try {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        `online-room:${roomId}`,
      ]);
    } catch {
      failure = new Error("Video lock nije oslobođen.");
    } finally {
      client.release(failure);
    }
  }

  /** Izdaje pristup tek poslije vlasništva, statusa i roka; token se ne upisuje u bazu. */
  async join(token: string | undefined, bookingId: string) {
    const user = await this.auth.getAccount(token);
    const booking = await this.booking(user, bookingId);
    const information = this.details(booking, user);
    if (!information.configured)
      throw new ServiceUnavailableException(information.reason);
    if (!information.canJoin) throw new ConflictException(information.reason);
    await this.auth.limitAttempts(`video-join:${user.id}`, 30, 300);

    // Rezervišemo identitet sobe u jednoj kratkoj SQL naredbi. Mrežno čekanje nikad ne drži transakciju.
    await this.database.pool.query(
      `INSERT INTO online_session_rooms(booking_id,booking_version,room_name,expires_at)
       SELECT id,state_version,$3,end_at+interval '10 minutes' FROM booking_requests
       WHERE id=$1 AND state_version=$2 AND status='CONFIRMED' AND online
       AND now()>=start_at-interval '10 minutes' AND now()<end_at+interval '10 minutes'
       ON CONFLICT(booking_id,booking_version) DO NOTHING`,
      [
        booking.id,
        booking.state_version,
        `tm-${randomUUID().replaceAll("-", "")}`,
      ],
    );
    const stored = await this.database.pool.query<SessionRoom>(
      "SELECT * FROM online_session_rooms WHERE booking_id=$1 AND booking_version=$2",
      [booking.id, booking.state_version],
    );
    const room = stored.rows[0];
    if (!room || room.revoked_at || room.closed_at)
      throw new ConflictException(
        "Termin je promijenjen. Osvježite rezervaciju.",
      );
    const locked = await this.lockRoom(room.id);
    if (!locked)
      throw new ConflictException(
        "Drugi učesnik upravo priprema sobu. Pokušajte ponovo za nekoliko sekundi.",
      );
    try {
      // Zaključavanje može stići poslije radnika za brisanje; tada ne smijemo ponovo napraviti opozvanu sobu.
      const ready = await locked.query(
        "SELECT id FROM online_session_rooms WHERE id=$1 AND revoked_at IS NULL AND closed_at IS NULL",
        [room.id],
      );
      if (!ready.rowCount)
        throw new ConflictException(
          "Termin je promijenjen. Osvježite rezervaciju.",
        );
      const roomUrl = await this.daily.ensureRoom(
        room.room_name,
        new Date(information.opensAt),
        new Date(information.closesAt),
      );
      const meetingToken = await this.daily.meetingToken(
        room.room_name,
        user.id,
        user.role as "CLIENT" | "THERAPIST",
        new Date(information.closesAt),
      );
      // Otkazivanje, pomjeranje, suspenzija ili istek tokom provider zahtjeva poništava i upravo izdat token.
      const current = await this.booking(user, bookingId, locked);
      const validRoom = await locked.query(
        "SELECT id FROM online_session_rooms WHERE id=$1 AND revoked_at IS NULL AND closed_at IS NULL",
        [room.id],
      );
      if (
        current.state_version !== booking.state_version ||
        !this.details(current, user).canJoin ||
        !validRoom.rowCount
      ) {
        await locked.query(
          "UPDATE online_session_rooms SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1",
          [room.id],
        );
        void this.closeRevokedRooms();
        throw new ConflictException(
          "Termin je promijenjen. Osvježite rezervaciju.",
        );
      }
      return {
        provider: "daily" as const,
        roomUrl,
        token: meetingToken,
        expiresAt: information.closesAt,
      };
    } finally {
      await this.unlockRoom(locked, room.id);
    }
  }

  /** Objedinjuje paralelna buđenja; greška zadržava redove za naredni pokušaj bez curenja tajni. */
  async closeRevokedRooms(): Promise<void> {
    if (this.cleanup || configuredVideoProvider() !== "daily") return;
    this.cleanup = this.performCleanup();
    try {
      await this.cleanup;
    } catch {
      this.logger.warn(
        "Zatvaranje video soba nije uspjelo; slijedi novi pokušaj.",
      );
    } finally {
      this.cleanup = null;
    }
  }

  /** Provjerava i suspenzije naloga; izbacivanje i brisanje idu prije evidentiranja zatvaranja. */
  private async performCleanup(): Promise<void> {
    const result = await this.database.pool.query<
      SessionRoom & {
        client_user_id: string | null;
        therapist_user_id: string | null;
      }
    >(
      `SELECT r.*,b.client_user_id,t.linked_user_id AS therapist_user_id FROM online_session_rooms r
       JOIN booking_requests b ON b.id=r.booking_id JOIN therapists t ON t.id=b.therapist_id
       LEFT JOIN users cu ON cu.id=b.client_user_id LEFT JOIN users tu ON tu.id=t.linked_user_id
       WHERE r.closed_at IS NULL AND (r.revoked_at IS NOT NULL OR r.expires_at<=now() OR b.status<>'CONFIRMED'
       OR b.state_version<>r.booking_version OR NOT b.online OR NOT t.is_active
       OR cu.id IS NULL OR tu.id IS NULL OR cu.suspended_at IS NOT NULL OR tu.suspended_at IS NOT NULL
       OR cu.verified_at IS NULL OR tu.verified_at IS NULL OR cu.role<>'CLIENT' OR tu.role<>'THERAPIST') ORDER BY r.created_at LIMIT 20`,
    );
    for (const room of result.rows) {
      const locked = await this.lockRoom(room.id);
      if (!locked) continue;
      try {
        await locked.query(
          "UPDATE online_session_rooms SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1",
          [room.id],
        );
        const userIds: string[] = [];
        if (room.client_user_id) userIds.push(room.client_user_id);
        if (room.therapist_user_id) userIds.push(room.therapist_user_id);
        await this.daily.closeRoom(room.room_name, userIds);
        await locked.query(
          "UPDATE online_session_rooms SET closed_at=now() WHERE id=$1",
          [room.id],
        );
      } catch {
        this.logger.warn("Jedna video soba čeka ponovni pokušaj zatvaranja.");
      } finally {
        await this.unlockRoom(locked, room.id);
      }
    }
  }
}
