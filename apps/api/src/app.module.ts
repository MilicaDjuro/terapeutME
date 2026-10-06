// NestJS modul je spisak dijelova aplikacije koje treba uključiti.
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

// Za sada uključujemo samo provjeru rada. Ovdje se kasnije registruju novi moduli.
@Module({ controllers: [HealthController] })
export class AppModule {}
