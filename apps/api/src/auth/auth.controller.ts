import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { allowedOrigins } from "../config";
import { AuthService, SESSION_COOKIE, SESSION_SECONDS } from "./auth.service";
import {
  requireBody,
  requireChallengeId,
  requireEmail,
  requireText,
  validateRegistration,
  validateTherapistRegistration,
  validateTherapistProfile,
  validateAccountProfile,
  validatePasswordReset,
} from "./auth.validation";
import { PasswordResetService } from "./password-reset.service";

/** Čita samo naš kolačić bez dodatne biblioteke i ignoriše neispravno kodirane vrijednosti. */
export function sessionToken(request: Request): string | undefined {
  for (const item of (request.headers.cookie || "").split(";")) {
    const separator = item.indexOf("=");
    if (item.slice(0, separator).trim() === SESSION_COOKIE) {
      try {
        return decodeURIComponent(item.slice(separator + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Za promjene zahtijeva dozvoljeni Origin i JSON; SameSite sam ne štiti login od CSRF-a. */
@Injectable()
export class AuthOriginGuard implements CanActivate {
  /** Odbija strane forme i zahtjeve bez očekivanih zaglavlja prije poslovnih koraka. */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === "GET") return true;
    if (
      !allowedOrigins().includes(request.headers.origin || "") ||
      !(
        request.is("application/json") ||
        (request.method === "POST" &&
          (request.path === "/api/v1/auth/therapist-profile/photos" ||
            request.path === "/api/v1/client-materials" ||
            /^\/api\/v1\/client-materials\/[a-f0-9-]{36}\/update$/i.test(
              request.path,
            )) &&
          request.is("multipart/form-data"))
      )
    ) {
      throw new ForbiddenException("Zahtjev mora doći sa dozvoljene stranice.");
    }
    return true;
  }
}

/** Izlaže javnu registraciju/prijavu i podatke samo trenutne sesije; nema biranja uloge. */
@Controller("auth")
@UseGuards(AuthOriginGuard)
export class AuthController {
  /** Povezuje HTTP radnje sa servisom koji koristi bazu. */
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PasswordResetService)
    private readonly passwordReset: PasswordResetService,
  ) {}

  /** Postavlja HttpOnly kolačić; produkcija ga šalje isključivo preko HTTPS-a. */
  private setSession(response: Response, token: string) {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_SECONDS * 1000,
    });
  }

  /** Ograničava opterećenje po stvarnoj socket adresi; proslijeđena IP zaglavlja nijesu pouzdana. */
  private async limitRequest(
    request: Request,
    operation: string,
    maximum: number,
  ) {
    await this.auth.limitAttempts(
      `ip:${operation}:${request.socket.remoteAddress}`,
      maximum,
      900,
    );
  }

  /** Provjerava registraciju i šalje kod; nalog još nije kreiran. */
  @Post("register")
  @Header("Cache-Control", "no-store")
  async register(@Body() body: unknown, @Req() request: Request) {
    await this.limitRequest(request, "register", 30);
    return this.auth.startRegistration(validateRegistration(body));
  }

  /** Registruje terapeuta kroz poseban provjeren tok; zahtjev ne može dodijeliti ADMIN ulogu. */
  @Post("register/therapist")
  @Header("Cache-Control", "no-store")
  async registerTherapist(@Body() body: unknown, @Req() request: Request) {
    await this.limitRequest(request, "register", 30);
    const input = validateTherapistRegistration(body);
    return this.auth.startRegistration(input.registration, input.profile);
  }

  /** Potvrđuje kod i automatski prijavljuje upravo kreirani nalog. */
  @Post("verify")
  @Header("Cache-Control", "no-store")
  async verify(
    @Body() value: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limitRequest(request, "verify", 100);
    const body = requireBody(value);
    const code = requireText(body.code, "Kod", 4);
    if (!/^\d{4}$/.test(code))
      throw new ForbiddenException("Unesite tačno četiri cifre.");
    const result = await this.auth.verifyRegistration(
      requireChallengeId(body.challengeId),
      code,
    );
    this.setSession(response, result.token);
    return { user: result.user };
  }

  /** Ponovo šalje kod tek nakon serverski provjerenog vremena čekanja. */
  @Post("resend")
  @Header("Cache-Control", "no-store")
  async resend(@Body() value: unknown, @Req() request: Request) {
    await this.limitRequest(request, "resend", 30);
    return this.auth.resendCode(
      requireChallengeId(requireBody(value).challengeId),
    );
  }

  /** Prijavljuje potvrđen nalog sa emailom i lozinkom. */
  @Post("login")
  @Header("Cache-Control", "no-store")
  async login(
    @Body() value: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limitRequest(request, "login", 60);
    const body = requireBody(value);
    const result = await this.auth.login(
      requireEmail(body.email),
      requireText(body.password, "Lozinka", 128, false),
    );
    // Zamjenjujemo prethodnu sesiju umjesto preuzimanja postojećeg tokena.
    await this.auth.logout(sessionToken(request));
    this.setSession(response, result.token);
    return { user: result.user };
  }

  /** Vraća vlastiti nalog; proizvoljni ID i demo uloga ne utiču na identitet. */
  @Get("me")
  @Header("Cache-Control", "no-store")
  async me(@Req() request: Request) {
    return { user: await this.auth.getAccount(sessionToken(request)) };
  }

  /** Prima zahtjev za email link; odgovor ne otkriva da li nalog postoji. */
  @Post("forgot-password")
  @Header("Cache-Control", "no-store")
  async forgotPassword(@Body() value: unknown, @Req() request: Request) {
    await this.limitRequest(request, "forgot-password", 10);
    return this.passwordReset.requestReset(
      requireEmail(requireBody(value).email),
      request.headers.origin!,
    );
  }

  /** Nakon jednokratne obnove postavlja novi HttpOnly JWT kolačić za stvarnu ulogu korisnika. */
  @Post("reset-password")
  @Header("Cache-Control", "no-store")
  async resetPassword(
    @Body() value: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limitRequest(request, "reset-password", 30);
    const input = validatePasswordReset(value);
    const result = await this.passwordReset.resetPassword(
      input.token,
      input.password,
    );
    await this.auth.logout(sessionToken(request));
    this.setSession(response, result.token);
    return { user: result.user };
  }

  /** Čuva lične podatke prijavljenog vlasnika; ID i uloga iz zahtjeva se ne koriste. */
  @Post("profile")
  @Header("Cache-Control", "no-store")
  async updateAccountProfile(@Body() body: unknown, @Req() request: Request) {
    return {
      user: await this.auth.updateAccountProfile(
        sessionToken(request),
        validateAccountProfile(body),
      ),
    };
  }

  /** Vraća vlastiti terapeutski profil nakon serverske provjere sesije i uloge. */
  @Get("therapist-profile")
  @Header("Cache-Control", "no-store")
  async therapistProfile(@Req() request: Request) {
    return {
      therapistProfile: await this.auth.getTherapistProfile(
        sessionToken(request),
      ),
    };
  }

  /** Čuva javne podatke samo vlasnika terapeutske sesije; ne prihvata tuđi ID ili privilegije. */
  @Post("therapist-profile")
  @Header("Cache-Control", "no-store")
  async updateTherapistProfile(@Body() body: unknown, @Req() request: Request) {
    return {
      therapistProfile: await this.auth.updateTherapistProfile(
        sessionToken(request),
        validateTherapistProfile(body),
      ),
    };
  }

  /** Briše sesiju iz baze i kolačić iz browsera. */
  @Post("logout")
  @Header("Cache-Control", "no-store")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(sessionToken(request));
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return { ok: true };
  }
}
