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
import { BookingService } from "./booking.service";

/** Izlaže javnu zauzetost i privatne radnje; ulogu i vlasnika svaki put provjerava servis. */
@Controller()
@UseGuards(AuthOriginGuard)
export class BookingController {
  /** Povezuje HTTP adrese sa imenovanim poslovnim koracima. */
  constructor(
    @Inject(BookingService) private readonly bookings: BookingService,
  ) {}
  /** Vraća slobodne i zauzete početke bez privatnih podataka klijenata. */
  @Get("therapists/:id/slots")
  @Header("Cache-Control", "no-store")
  slots(
    @Param("id") id: string,
    @Query("duration") duration: string,
    @Query("date") date: string,
  ) {
    return this.bookings.slots(id, duration, date);
  }
  /** Vraća samo vlastiti raspored terapeuta. */
  @Get("schedule")
  @Header("Cache-Control", "no-store")
  schedule(@Req() request: Request) {
    return this.bookings.schedule(sessionToken(request));
  }
  /** Čuva samo vlastito radno vrijeme i cijene. */
  @Post("schedule")
  @Header("Cache-Control", "no-store")
  saveSchedule(@Req() request: Request, @Body() body: unknown) {
    return this.bookings.saveSchedule(sessionToken(request), body);
  }
  /** Zakazuje termin samo prijavljenom pacijentu; cijenu i trajanje bira server. */
  @Post("bookings")
  @Header("Cache-Control", "no-store")
  create(@Req() request: Request, @Body() body: unknown) {
    return this.bookings.create(sessionToken(request), body);
  }
  /** Čita samo rezervacije vlasnika sesije. */
  @Get("bookings")
  @Header("Cache-Control", "no-store")
  list(@Req() request: Request) {
    return this.bookings.list(sessionToken(request));
  }
  /** Čuva dozvoljenu promjenu statusa ili predlog termina zajedno sa istorijom. */
  @Post("bookings/:id/respond")
  @Header("Cache-Control", "no-store")
  respond(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.bookings.respond(sessionToken(request), id, body);
  }
}
