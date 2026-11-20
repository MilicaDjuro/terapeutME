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
import { SessionRatingService } from "./session-rating.service";

/** Ocjene koriste postojeći JWT i zaštitu od upisa sa strane stranice. */
@Controller("bookings")
@UseGuards(AuthOriginGuard)
export class SessionRatingController {
  /** Povezuje HTTP adresu sa provjerama vlasnika i završetka seanse. */
  constructor(
    @Inject(SessionRatingService)
    private readonly ratings: SessionRatingService,
  ) {}

  /** Upisuje samo ocjenu; klijenta i terapeuta ne prihvata iz formulara. */
  @Post(":id/rating")
  @Header("Cache-Control", "private, no-store")
  save(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.ratings.save(sessionToken(request), id, body);
  }
}
