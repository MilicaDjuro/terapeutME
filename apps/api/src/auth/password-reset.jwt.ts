import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sign, verify } from "jsonwebtoken";

export const PASSWORD_RESET_SECONDS = 15 * 60;
export const INVALID_RESET_LINK =
  "Link za obnovu lozinke nije ispravan ili je istekao. Zatražite novi link.";

/** Potpisuje kratkotrajni JWT za obnovu; njegova namjena se razlikuje od JWT-a za prijavu. */
export function createPasswordResetToken(userId: string): string {
  return sign({ purpose: "password-reset" }, process.env.AUTH_SECRET!, {
    algorithm: "HS256",
    issuer: "terapeut.me-api",
    audience: "terapeut.me-password-reset",
    subject: userId,
    jwtid: randomUUID(),
    expiresIn: PASSWORD_RESET_SECONDS,
  });
}

/** Provjerava potpis, rok i namjenu; baza dodatno odlučuje da li je link već iskorišćen. */
export function verifyPasswordResetToken(token: string): { sub: string } {
  try {
    if (!token || token.length > 2048) throw new Error("Neispravan token.");
    const claims = verify(token, process.env.AUTH_SECRET!, {
      algorithms: ["HS256"],
      issuer: "terapeut.me-api",
      audience: "terapeut.me-password-reset",
    });
    if (
      typeof claims === "string" ||
      claims.purpose !== "password-reset" ||
      typeof claims.sub !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(claims.sub) ||
      typeof claims.jti !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(claims.jti) ||
      typeof claims.exp !== "number"
    )
      throw new Error("Neispravna namjena.");
    return { sub: claims.sub };
  } catch {
    throw new BadRequestException(INVALID_RESET_LINK);
  }
}
