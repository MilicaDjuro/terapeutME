import "./config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import {
  allowedOrigins,
  apiListenAddress,
  validateConfiguration,
} from "./config";
import express from "express";

/** Kreira API i dozvoljeni frontend; u produkciji sluša i zahtjeve Render proxy-ja. */
async function bootstrap() {
  validateConfiguration();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Kratak JSON limit sprečava slanje ogromnih formulara; tajne se nikada ne loguju.
  app.use(express.json({ limit: "16kb" }));
  app.enableShutdownHooks();
  app.setGlobalPrefix("api/v1");
  // Browser dozvoljava frontend pozive samo sa ovog origin-a (adrese sa portom).
  app.enableCors({
    origin: allowedOrigins(),
    credentials: true,
  });
  const address = apiListenAddress();
  await app.listen(address.port, address.host);
}
// Ovo je ulaz u API program. Greška pri pokretanju upisuje se u terminal.
bootstrap().catch((error) => {
  console.error(
    "API startup failed:",
    error instanceof Error ? error.message : "Nepoznata greška.",
  );
  process.exitCode = 1;
});
