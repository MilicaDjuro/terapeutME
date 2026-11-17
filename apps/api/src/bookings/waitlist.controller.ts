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
import { WaitlistService } from "./waitlist.service";

/** Prima prijavu i povlačenje; identitet i vlasništvo određuje server preko JWT sesije. */
@Controller("waitlist")
@UseGuards(AuthOriginGuard)
export class WaitlistController {
  /** Povezuje HTTP radnje sa servisom liste čekanja. */
  constructor(
    @Inject(WaitlistService) private readonly waitlist: WaitlistService,
  ) {}

  /** Čuva saglasnost i željene dane/vrijeme samo prijavljenog klijenta. */
  @Post()
  @Header("Cache-Control", "no-store")
  join(@Req() request: Request, @Body() body: unknown) {
    return this.waitlist.join(sessionToken(request), body);
  }

  /** Povlači vlastitu prijavu; ne otkazuje već dodijeljenu seansu. */
  @Post(":id/cancel")
  @Header("Cache-Control", "no-store")
  cancel(@Req() request: Request, @Param("id") id: string) {
    return this.waitlist.cancel(sessionToken(request), id);
  }
}
