// Controller povezuje HTTP adresu sa običnom metodom koja vraća odgovor.
import { Controller, Get } from "@nestjs/common";

// Zajednički početak /api/v1 dodaje main.ts. Ovdje dodajemo /health.
@Controller("health")
export class HealthController {
  /** Odgovara na GET /api/v1/health i iskreno navodi šta još nije povezano. */
  @Get()
  health() {
    return {
      status: "ok",
      application: "terapeut-me",
      version: "0.1.0",
      database: "not-connected",
      bookingApi: "not-enabled",
    };
  }
}
