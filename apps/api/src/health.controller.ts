// Controller povezuje HTTP adresu sa običnom metodom koja vraća odgovor.
import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "./database.service";
import { configuredEmailMode, configuredVideoProvider } from "./config";

// Zajednički početak /api/v1 dodaje main.ts. Ovdje dodajemo /health.
@Controller("health")
export class HealthController {
  /** Prima bazu da provjera rada potvrdi stvarnu vezu i primijenjenu auth migraciju. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  /** Odgovara na GET /api/v1/health i iskreno navodi šta još nije povezano. */
  @Get()
  async health() {
    try {
      const migration = await this.database.pool.query(
        "SELECT name FROM schema_migrations WHERE name IN ('002-auth','003-therapist-registration','004-directory-photos','005-booking-sessions','006-profile-contact','007-password-reset','008-date-availability','009-booking-notifications','010-recurring-bookings','011-waitlist','012-client-materials')",
      );
      const features = await this.database.pool.query(
        "SELECT name FROM schema_migrations WHERE name IN ('013-profile-analytics','014-profile-view-events','015-therapist-notes','016-session-ratings')",
      );
      const online = await this.database.pool.query(
        "SELECT name FROM schema_migrations WHERE name='015-online-sessions'",
      );
      if (
        migration.rowCount !== 11 ||
        analytics.rowCount !== 2 ||
        online.rowCount !== 1
      )
        throw new Error("Migracije nijesu primijenjene.");
    } catch {
      throw new ServiceUnavailableException(
        "Baza nije spremna. Provjerite konekciju i auth migraciju.",
      );
    }
    return {
      status: "ok",
      application: "terapeut-me",
      version: "0.1.0",
      database: "connected",
      emailDelivery: configuredEmailMode(),
      authentication: "enabled",
      bookingApi: "enabled",
      bookingNotifications: "outbox",
      recurringBookings: "enabled",
      waitlist: "enabled",
      clientMaterials: "private",
      profileAnalytics: "enabled",
      therapistNotes: "private",
      sessionRatings: "enabled",
      onlineSessions: configuredVideoProvider(),
    };
  }
}
