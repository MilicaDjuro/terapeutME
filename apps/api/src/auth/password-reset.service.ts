import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database.service";
import { allowedOrigins } from "../config";
import { AuthService, accountUser, USER_COLUMNS } from "./auth.service";
import { EmailService } from "./email.service";
import { hashPassword, hashToken } from "./auth.crypto";
import type { UserRow } from "./auth.types";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
  PASSWORD_RESET_SECONDS,
  INVALID_RESET_LINK,
} from "./password-reset.jwt";

export const RESET_REQUEST_MESSAGE =
  "Ako postoji aktivan nalog sa ovom email adresom, uputstvo za obnovu lozinke stići će na email.";

/** Vodi obnovu lozinke odvojeno od registracije; nikad ne vraća reset token browseru kroz API. */
@Injectable()
export class PasswordResetService {
  /** Koristi postojeće hashiranje, SMTP i izdavanje sesije, bez novog načina prijave. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  /** Pravi link samo ka dozvoljenoj adresi aplikacije; Host i proizvoljan URL iz formulara se ne koriste. */
  private resetLink(token: string, origin: string): string {
    if (!allowedOrigins().includes(origin))
      throw new BadRequestException("Adresa aplikacije nije dozvoljena.");
    const link = new URL("/reset-password", origin);
    // Fragment ostaje u browseru: ne ulazi u HTTP putanju, server logove ili Referer zaglavlje.
    link.hash = new URLSearchParams({ token }).toString();
    return link.toString();
  }

  /** Ne otkriva postoji li email; novi zahtjev poništava prethodni link istog korisnika. */
  async requestReset(emailAddress: string, origin: string) {
    if (!allowedOrigins().includes(origin))
      throw new BadRequestException("Adresa aplikacije nije dozvoljena.");
    await this.auth.limitAttempts(`password-reset:${emailAddress}`, 3, 3600);
    let resetToken = "";
    let resetHash = "";
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      // I izdavanje i korišćenje linka prvo zaključavaju users red, pa tek reset zapise.
      const result = await client.query<{ id: string }>(
        "SELECT id FROM users WHERE lower(email)=$1 AND verified_at IS NOT NULL AND suspended_at IS NULL FOR UPDATE",
        [emailAddress],
      );
      const user = result.rows[0];
      if (user) {
        resetToken = createPasswordResetToken(user.id);
        resetHash = hashToken(resetToken);
        await client.query(
          "DELETE FROM password_reset_tokens WHERE user_id=$1",
          [user.id],
        );
        await client.query(
          "INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES ($1,$2,now()+$3*interval '1 second')",
          [resetHash, user.id, PASSWORD_RESET_SECONDS],
        );
      }
      await client.query("COMMIT");
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
    if (resetToken) {
      try {
        await this.email.sendPasswordResetLink(
          emailAddress,
          this.resetLink(resetToken, origin),
        );
      } catch {
        // Nema upotrebljivog linka kada slanje ne uspije; odgovor ostaje isti za poznate i nepoznate adrese.
        await this.database.pool.query(
          "DELETE FROM password_reset_tokens WHERE token_hash=$1",
          [resetHash],
        );
        console.error("Email za obnovu lozinke nije isporučen.");
      }
    }
    return { message: RESET_REQUEST_MESSAGE, delivery: this.email.mode };
  }

  /** Atomski mijenja hash lozinke, troši link, opoziva stare sesije i izdaje novu JWT sesiju. */
  async resetPassword(token: string, password: string) {
    const claims = verifyPasswordResetToken(token);
    const passwordHash = await hashPassword(password);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<UserRow>(
        `SELECT ${USER_COLUMNS} FROM users WHERE id=$1 AND verified_at IS NOT NULL AND suspended_at IS NULL FOR UPDATE`,
        [claims.sub],
      );
      const user = result.rows[0];
      const reset = await client.query(
        "SELECT token_hash FROM password_reset_tokens WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE",
        [hashToken(token), claims.sub],
      );
      if (!user || !reset.rowCount)
        throw new BadRequestException(INVALID_RESET_LINK);
      await client.query(
        "UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1",
        [user.id, passwordHash],
      );
      await client.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [
        user.id,
      ]);
      await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [
        user.id,
      ]);
      const account = accountUser(user);
      const sessionToken = await this.auth.createSession(client, account);
      await client.query("COMMIT");
      return { user: account, token: sessionToken };
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }
}
