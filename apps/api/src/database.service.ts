import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";

/** Dijeli PostgreSQL konekcije; svaki poslovni SQL koristi parametre umjesto spajanja teksta. */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 15000,
  });

  /** Zatvara konekcije pri gašenju NestJS aplikacije. */
  async onModuleDestroy() {
    await this.pool.end();
  }
}
