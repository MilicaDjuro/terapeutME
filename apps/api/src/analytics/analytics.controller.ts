import {
  Controller,
  Body,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { AuthOriginGuard, sessionToken } from "../auth/auth.controller";
import { AnalyticsService } from "./analytics.service";

/** Privatni pregled i upis prikaza koriste postojeći JWT kolačić i zaštitu porijekla. */
@Controller("analytics")
@UseGuards(AuthOriginGuard)
export class AnalyticsController {
  /** Povezuje HTTP sa provjerama uloge i vlasništva u servisu. */
  constructor(
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Vraća zbirne podatke trenutnog terapeuta, bez identiteta posjetilaca. */
  @Get()
  @Header("Cache-Control", "no-store")
  overview(
    @Req() request: Request,
    @Query("days") days?: string,
    @Query("page") page?: string,
  ) {
    return this.analytics.overview(sessionToken(request), days, page);
  }

  /** Otvaranje profila je zaseban POST; katalog i Next prefetch ne povećavaju broj. */
  @Post("profiles/:id/view")
  @Header("Cache-Control", "no-store")
  async view(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Mijenjanje kolačića ne smije zaobići zaštitu od masovnog upisa sa iste mrežne adrese.
    await this.auth.limitAttempts(
      `profile-view-network:${request.socket.remoteAddress || "unknown"}`,
      10000,
      3600,
    );
    const token = sessionToken(request);
    let anonymousId: string | undefined;
    if (!token) {
      for (const part of (request.headers.cookie || "").split(";")) {
        const [name, value] = part.trim().split("=");
        if (
          name === "terapeut_analytics" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
            value || "",
          )
        )
          anonymousId = value;
      }
      if (!anonymousId) {
        anonymousId = randomUUID();
        response.cookie("terapeut_analytics", anonymousId, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
      }
    }
    return this.analytics.recordView(token, id, body, anonymousId);
  }
}
