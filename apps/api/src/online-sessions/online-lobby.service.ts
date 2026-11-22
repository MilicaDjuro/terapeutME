import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DatabaseService } from "../database.service";

export type LobbyAction = "ready" | "heartbeat" | "start" | "leave";
export interface LobbyState {
  id: string | null;
  startedAt: string | null;
  therapistReady: boolean;
  clientReady: boolean;
}
interface LobbyRow {
  generation: string;
  started_at: Date | null;
  therapist_presence_id: string | null;
  client_presence_id: string | null;
  therapist_ready_at: Date | null;
  client_ready_at: Date | null;
  therapist_ready: boolean;
  client_ready: boolean;
}

/** Čuva prisustvo u našoj čekaonici; nijedna metoda ne kontaktira Daily niti izdaje video token. */
@Injectable()
export class OnlineLobbyService {
  /** Dobija bazu; autorizaciju i stanje rezervacije provjerava OnlineSessionsService. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /** Istečeno prisustvo ne može ponovo oživjeti razgovor običnim zakašnjelim heartbeat-om. */
  private async expire(
    connection: Pool | PoolClient,
    bookingId: string,
    version: number,
  ) {
    await connection.query(
      `UPDATE online_session_lobbies SET
      therapist_ready_at=CASE WHEN therapist_ready_at>now()-interval '30 seconds' THEN therapist_ready_at ELSE NULL END,
      client_ready_at=CASE WHEN client_ready_at>now()-interval '30 seconds' THEN client_ready_at ELSE NULL END,
      started_at=CASE WHEN therapist_ready_at>now()-interval '30 seconds' AND client_ready_at>now()-interval '30 seconds' THEN started_at ELSE NULL END,
      generation=CASE WHEN started_at IS NOT NULL AND NOT (COALESCE(therapist_ready_at>now()-interval '30 seconds',false) AND COALESCE(client_ready_at>now()-interval '30 seconds',false)) THEN gen_random_uuid() ELSE generation END
      WHERE booking_id=$1 AND booking_version=$2 AND
      ((therapist_ready_at IS NOT NULL AND therapist_ready_at<=now()-interval '30 seconds')
      OR (client_ready_at IS NOT NULL AND client_ready_at<=now()-interval '30 seconds'))`,
      [bookingId, version],
    );
  }

  /** Čita trenutni red; vrijeme provjerava PostgreSQL, nezavisno od sata klijenta. */
  private async row(
    connection: Pool | PoolClient,
    bookingId: string,
    version: number,
  ): Promise<LobbyRow | undefined> {
    const result = await connection.query<LobbyRow>(
      `SELECT *,
      COALESCE(therapist_ready_at>now()-interval '30 seconds',false) AS therapist_ready,
      COALESCE(client_ready_at>now()-interval '30 seconds',false) AS client_ready
      FROM online_session_lobbies WHERE booking_id=$1 AND booking_version=$2`,
      [bookingId, version],
    );
    return result.rows[0];
  }

  /** Izostavlja oznake browsera iz odgovora; učesnici vide samo spremnost i odobreni početak. */
  private view(row?: LobbyRow): LobbyState {
    return {
      id: row?.generation || null,
      startedAt: row?.started_at?.toISOString() || null,
      therapistReady: row?.therapist_ready === true,
      clientReady: row?.client_ready === true,
    };
  }

  /** Prikazuje čekanje i uklanja zastarjelo prisustvo bez stvaranja video sobe. */
  async state(bookingId: string, version: number): Promise<LobbyState> {
    await this.expire(this.database.pool, bookingId, version);
    return this.view(await this.row(this.database.pool, bookingId, version));
  }

  /** Atomski upisuje spremnost/početak/izlazak pod lock-om lobija; nikad ne mijenja status rezervacije. */
  async update(
    bookingId: string,
    version: number,
    role: "CLIENT" | "THERAPIST",
    presenceId: string,
    action: LobbyAction,
  ): Promise<LobbyState> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      if (action !== "leave") {
        const booking = await client.query(
          `SELECT id FROM booking_requests WHERE id=$1 AND state_version=$2 AND status='CONFIRMED' AND online
          AND now()>=start_at-interval '10 minutes' AND now()<end_at+interval '10 minutes' FOR SHARE`,
          [bookingId, version],
        );
        if (!booking.rowCount)
          throw new ConflictException(
            "Termin više nije dostupan za čekaonicu.",
          );
      }
      await client.query(
        "INSERT INTO online_session_lobbies(booking_id,booking_version) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [bookingId, version],
      );
      await client.query(
        "SELECT booking_id FROM online_session_lobbies WHERE booking_id=$1 AND booking_version=$2 FOR UPDATE",
        [bookingId, version],
      );
      await this.expire(client, bookingId, version);
      const current = (await this.row(client, bookingId, version))!;
      const ownId =
        role === "THERAPIST"
          ? current.therapist_presence_id
          : current.client_presence_id;
      const ownReady =
        role === "THERAPIST" ? current.therapist_ready : current.client_ready;
      // Imena kolona dolaze isključivo iz provjerene uloge, nikad iz korisnikovog teksta.
      const idColumn =
        role === "THERAPIST" ? "therapist_presence_id" : "client_presence_id";
      const timeColumn =
        role === "THERAPIST" ? "therapist_ready_at" : "client_ready_at";
      if (action === "ready") {
        if (
          (ownReady && ownId !== presenceId) ||
          (ownId === presenceId && !ownReady)
        )
          throw new ConflictException(
            "Čekaonica je otvorena u drugom prozoru ili je prisustvo isteklo. Ponovo označite da ste spremni.",
          );
        await client.query(
          `UPDATE online_session_lobbies SET ${idColumn}=$3,${timeColumn}=now() WHERE booking_id=$1 AND booking_version=$2`,
          [bookingId, version, presenceId],
        );
      } else if (action === "heartbeat") {
        if (!ownReady || ownId !== presenceId)
          throw new ConflictException(
            "Prisustvo u čekaonici je isteklo. Ponovo označite da ste spremni.",
          );
        await client.query(
          `UPDATE online_session_lobbies SET ${timeColumn}=now() WHERE booking_id=$1 AND booking_version=$2`,
          [bookingId, version],
        );
      } else if (action === "start") {
        if (
          role !== "THERAPIST" ||
          ownId !== presenceId ||
          !current.therapist_ready ||
          !current.client_ready
        )
          throw new ConflictException(
            "Razgovor može pokrenuti terapeut kada su oba učesnika spremna u čekaonici.",
          );
        await client.query(
          "UPDATE online_session_lobbies SET started_at=COALESCE(started_at,now()) WHERE booking_id=$1 AND booking_version=$2",
          [bookingId, version],
        );
      } else {
        // Stari tab ne smije odjaviti noviji tab istog naloga; prazna oznaka čuva i zakašnjelo otkazivanje ulaska.
        if (ownId === presenceId || ownId === null)
          await client.query(
            `UPDATE online_session_lobbies SET ${idColumn}=$3,${timeColumn}=NULL,started_at=NULL,
            generation=CASE WHEN started_at IS NOT NULL THEN gen_random_uuid() ELSE generation END WHERE booking_id=$1 AND booking_version=$2`,
            [bookingId, version, presenceId],
          );
      }
      const result = this.view(await this.row(client, bookingId, version));
      await client.query("COMMIT");
      return result;
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Prije i poslije izdavanja tokena traži isti odobreni početak i svježe prisustvo oba učesnika. */
  async permitsJoin(
    bookingId: string,
    version: number,
    role: "CLIENT" | "THERAPIST",
    presenceId: string,
    lobbyId: string,
    connection: Pool | PoolClient = this.database.pool,
  ): Promise<boolean> {
    const column =
      role === "THERAPIST" ? "therapist_presence_id" : "client_presence_id";
    const result = await connection.query(
      `SELECT booking_id FROM online_session_lobbies WHERE booking_id=$1 AND booking_version=$2
      AND generation=$3 AND ${column}=$4 AND started_at IS NOT NULL
      AND therapist_ready_at>now()-interval '30 seconds' AND client_ready_at>now()-interval '30 seconds'`,
      [bookingId, version, lobbyId, presenceId],
    );
    return result.rowCount === 1;
  }
}
