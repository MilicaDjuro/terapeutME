import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

/** Kreira API, podešava adrese i dozvoljeni frontend i otvara lokalni port. */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  // Browser dozvoljava frontend pozive samo sa ovog origin-a (adrese sa portom).
  app.enableCors({
    origin: process.env.WEB_ORIGIN || "http://localhost:3000",
    credentials: true,
  });
  await app.listen(Number(process.env.API_PORT || 4000), "127.0.0.1");
}
// Ovo je ulaz u API program. Greška pri pokretanju upisuje se u terminal.
bootstrap().catch((error) => {
  console.error("API startup failed:", error);
  process.exitCode = 1;
});
