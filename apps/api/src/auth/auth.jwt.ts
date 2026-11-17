import { UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sign, verify } from "jsonwebtoken";
import type { AccountUser } from "./auth.types";

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const JWT_ISSUER = "terapeut.me-api";
const JWT_AUDIENCE = "terapeut.me-web";

interface SessionClaims {
  sub: string;
  role: AccountUser["role"];
  jti: string;
  exp: number;
}

/** Potpisuje sedmodnevni JWT; nasumični jti razlikuje i dvije prijave u istoj sekundi. */
export function createSessionToken(user: AccountUser): string {
  return sign({ role: user.role }, process.env.AUTH_SECRET!, {
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject: user.id,
    jwtid: randomUUID(),
    expiresIn: SESSION_SECONDS,
  });
}

/** Provjerava potpis, rok i namjenu JWT-a; sama provjera još ne dokazuje aktivnu sesiju u bazi. */
export function verifySessionToken(token: string | undefined): SessionClaims {
  try {
    if (!token || token.length > 2048) throw new Error("Nedostaje JWT.");
    const claims = verify(token, process.env.AUTH_SECRET!, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (
      typeof claims === "string" ||
      typeof claims.sub !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(claims.sub) ||
      typeof claims.jti !== "string" ||
      typeof claims.exp !== "number" ||
      (claims.role !== "CLIENT" &&
        claims.role !== "THERAPIST" &&
        claims.role !== "ADMIN")
    )
      throw new Error("Neispravni JWT podaci.");
    return {
      sub: claims.sub,
      role: claims.role,
      jti: claims.jti,
      exp: claims.exp,
    };
  } catch {
    throw new UnauthorizedException("Sesija je istekla. Prijavite se ponovo.");
  }
}
