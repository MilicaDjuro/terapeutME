import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { configuredVideoProvider } from "../config";

/** Daily detalji ostaju ovdje; rezervacije i frontend ne zavise od njegovog REST formata. */
@Injectable()
export class DailyService {
  /** Pretvara interni identitet u pseudonim; ime, email i telefon ne šaljemo video servisu. */
  participantId(userId: string, roomName: string): string {
    return createHash("sha256")
      .update(`terapeut-video:${roomName}:${userId}`)
      .digest("hex")
      .slice(0, 32);
  }

  /** Šalje ograničen HTTPS zahtjev samo Daily-ju; odgovor i ključ nikad ne ulaze u grešku/log. */
  private async request(path: string, method: string, body?: unknown) {
    if (configuredVideoProvider() !== "daily")
      throw new ServiceUnavailableException(
        "Online pozivi još nijesu uključeni. Kontaktirajte terapeuta.",
      );
    try {
      const response = await fetch(`https://api.daily.co/v1/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      const value = (await response.json()) as Record<string, unknown>;
      return { status: response.status, value };
    } catch {
      throw new BadGatewayException(
        "Video servis trenutno nije dostupan. Pokušajte ponovo.",
      );
    }
  }

  /** Provjerava da je vraćena baš tražena privatna soba našeg Daily naloga. */
  private roomUrl(
    value: Record<string, unknown>,
    roomName: string,
    opensAt: Date,
    closesAt: Date,
  ): string {
    let address: URL;
    try {
      address = new URL(String(value.url));
    } catch {
      throw new BadGatewayException("Video servis nije vratio ispravnu sobu.");
    }
    const configuration = value.config as Record<string, unknown> | undefined;
    if (
      value.name !== roomName ||
      value.privacy !== "private" ||
      address.origin !== `https://${process.env.DAILY_DOMAIN}.daily.co` ||
      address.pathname !== `/${roomName}` ||
      address.search ||
      address.hash ||
      address.username ||
      address.password ||
      configuration?.max_participants !== 2 ||
      configuration?.eject_at_room_exp !== true ||
      configuration?.enforce_unique_user_ids !== true ||
      configuration?.enable_recording ||
      configuration?.exp !== Math.floor(closesAt.getTime() / 1000) ||
      configuration?.nbf !== Math.floor(opensAt.getTime() / 1000)
    )
      throw new BadGatewayException("Video soba nema očekivana podešavanja.");
    return address.toString();
  }

  /** Pravi sobu tek pri ulasku; ista nasumična oznaka omogućava bezbjedan ponovljeni/paralelni pokušaj. */
  async ensureRoom(
    roomName: string,
    opensAt: Date,
    closesAt: Date,
  ): Promise<string> {
    let result = await this.request(`rooms/${roomName}`, "GET");
    if (result.status === 404) {
      result = await this.request("rooms", "POST", {
        name: roomName,
        privacy: "private",
        properties: {
          nbf: Math.floor(opensAt.getTime() / 1000),
          exp: Math.floor(closesAt.getTime() / 1000),
          max_participants: 2,
          enforce_unique_user_ids: true,
          eject_at_room_exp: true,
          enable_knocking: false,
          enable_chat: false,
          enable_screenshare: true,
          enable_recording: false,
          enable_transcription_storage: false,
          enable_terse_logging: true,
          permissions: { canAdmin: false },
        },
      });
      // Drugi proces može upravo napraviti istu sobu. Čitamo i provjeravamo je, ne pravimo drugu.
      if (result.status === 400 || result.status === 409)
        result = await this.request(`rooms/${roomName}`, "GET");
    }
    if (result.status < 200 || result.status >= 300)
      throw new BadGatewayException(
        "Priprema video sobe nije uspjela. Pokušajte ponovo.",
      );
    return this.roomUrl(result.value, roomName, opensAt, closesAt);
  }

  /** Izdaje token samo za jednu sobu i jednog učesnika; niko ne dobija administratorsko snimanje. */
  async meetingToken(
    roomName: string,
    userId: string,
    role: "CLIENT" | "THERAPIST",
    closesAt: Date,
  ): Promise<string> {
    const result = await this.request("meeting-tokens", "POST", {
      properties: {
        room_name: roomName,
        user_id: this.participantId(userId, roomName),
        user_name: role === "THERAPIST" ? "Terapeut" : "Klijent",
        is_owner: false,
        nbf: Math.floor(Date.now() / 1000) - 5,
        exp: Math.floor(closesAt.getTime() / 1000),
        eject_at_token_exp: true,
        enable_recording_ui: false,
        enable_screenshare: true,
        enable_terse_logging: true,
        auto_start_transcription: false,
        permissions: { canAdmin: false },
      },
    });
    if (
      result.status !== 200 ||
      typeof result.value.token !== "string" ||
      result.value.token.length < 20
    )
      throw new BadGatewayException(
        "Ulazak u video sobu nije uspio. Pokušajte ponovo.",
      );
    return result.value.token;
  }

  /** Ukida postojeći poziv i ponovni ulazak; nepostojeća/istekla soba već je zatvorena. */
  async closeRoom(
    roomName: string,
    participantUserIds: string[],
  ): Promise<void> {
    const ejected = await this.request(`rooms/${roomName}/eject`, "POST", {
      user_ids: participantUserIds.map((userId) =>
        this.participantId(userId, roomName),
      ),
      ban: true,
    });
    // Brisanje sobe takođe prekida sastanak; pokušavamo i ako u njoj nema aktivne sesije za eject.
    const deleted = await this.request(`rooms/${roomName}`, "DELETE");
    if (
      ![200, 404].includes(deleted.status) ||
      ![200, 400, 404].includes(ejected.status)
    )
      throw new BadGatewayException("Zatvaranje video sobe čeka novi pokušaj.");
  }
}
