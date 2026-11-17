import {
  Body,
  Controller,
  Header,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthOriginGuard, sessionToken } from "../auth/auth.controller";
import { RecurringBookingService } from "./recurring-booking.service";

/** Prima radnje stalnih termina; servis izvodi ulogu i vlasnika iz JWT sesije. */
@Controller("booking-series")
@UseGuards(AuthOriginGuard)
export class RecurringBookingController {
  /** Povezuje HTTP zahtjeve sa odvojenim koracima čuvanja serije. */
  constructor(
    @Inject(RecurringBookingService)
    private readonly recurring: RecurringBookingService,
  ) {}

  /** Pravi pravilo iz postojećeg potvrđenog termina, bez proizvoljnog izbora tuđeg klijenta. */
  @Post()
  @Header("Cache-Control", "no-store")
  create(@Req() request: Request, @Body() body: unknown) {
    return this.recurring.create(sessionToken(request), body);
  }

  /** Prekida automatsko nastavljanje i otkazuje buduće seanse te serije. */
  @Post(":id/stop")
  @Header("Cache-Control", "no-store")
  stop(@Req() request: Request, @Param("id") id: string) {
    return this.recurring.stop(sessionToken(request), id);
  }

  /** Zakazuje zamjenu samo za označeni problematični datum. */
  @Post(":id/resolve")
  @Header("Cache-Control", "no-store")
  resolve(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.recurring.resolveIssue(sessionToken(request), id, body);
  }
}
