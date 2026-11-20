import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthOriginGuard, sessionToken } from "../auth/auth.controller";
import { OnlineSessionsService } from "./online-sessions.service";

/** Privatne video adrese koriste postojeći kolačić i CSRF provjeru; odgovori se nikad ne keširaju. */
@Controller("bookings/:id/online-session")
@UseGuards(AuthOriginGuard)
export class OnlineSessionsController {
  /** Povezuje transport sa provjerama rezervacije, bez provider logike u kontroleru. */
  constructor(
    @Inject(OnlineSessionsService)
    private readonly sessions: OnlineSessionsService,
  ) {}

  /** Priprema prikaz samo učesniku seanse; ne otkriva URL sobe ili token. */
  @Get()
  @Header("Cache-Control", "no-store")
  info(@Req() request: Request, @Param("id") id: string) {
    return this.sessions.info(sessionToken(request), id);
  }

  /** Kreira/ponovo koristi privatnu sobu i vraća pristup jednom učesniku. */
  @Post("join")
  @Header("Cache-Control", "no-store")
  join(@Req() request: Request, @Param("id") id: string) {
    return this.sessions.join(sessionToken(request), id);
  }
}
