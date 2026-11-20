import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthOriginGuard, sessionToken } from "../auth/auth.controller";
import { TherapistNotesService } from "./therapist-notes.service";

/** Privatne adrese bilješki uvijek provjeravaju JWT i vlasništvo na serveru. */
@Controller("therapist-notes")
@UseGuards(AuthOriginGuard)
export class TherapistNotesController {
  /** Povezuje HTTP sa provjerama servisa, bez biranja terapeuta kroz URL. */
  constructor(
    @Inject(TherapistNotesService)
    private readonly notes: TherapistNotesService,
  ) {}
  /** Vraća vlastite klijente, bez sadržaja bilješki. */
  @Get("clients")
  @Header("Cache-Control", "private, no-store")
  clients(@Req() request: Request) {
    return this.notes.clients(sessionToken(request));
  }
  /** Vraća samo vlastite bilješke jednog izabranog klijenta. */
  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Req() request: Request, @Query("clientId") clientId?: string) {
    return this.notes.list(sessionToken(request), clientId);
  }
  /** Dodaje bilješku koja je vidljiva samo autoru. */
  @Post()
  @Header("Cache-Control", "private, no-store")
  create(@Req() request: Request, @Body() body: unknown) {
    return this.notes.save(sessionToken(request), body);
  }
  /** Mijenja vlastitu bilješku uz provjeru verzije. */
  @Post(":id/update")
  @Header("Cache-Control", "private, no-store")
  update(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.notes.save(sessionToken(request), body, id);
  }
  /** Arhiviranje ne otkriva postoji li bilješka drugog terapeuta. */
  @Post(":id/archive")
  @Header("Cache-Control", "private, no-store")
  archive(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.notes.archive(sessionToken(request), id, body);
  }
}
