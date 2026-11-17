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
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { AuthOriginGuard, sessionToken } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { MaterialsService } from "./materials.service";
import type { MaterialUpload } from "./materials.validation";

/** Provjerava sesiju i ulogu prije nego što multipart parser učita PDF u memoriju. */
@Injectable()
export class MaterialsSessionGuard implements CanActivate {
  /** Koristi postojeću provjeru JWT sesije, suspenzije i ograničavanje pokušaja. */
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  /** Prijavljen klijent čita svoje materijale; samo terapeut smije da ih šalje i mijenja. */
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const user = await this.auth.getAccount(sessionToken(request));
    if (
      !["CLIENT", "THERAPIST"].includes(user.role) ||
      (request.method !== "GET" && user.role !== "THERAPIST")
    )
      throw new ForbiddenException(
        "Materijale dodaje i uređuje terapeut; klijent čita svoje materijale.",
      );
    if (request.is("multipart/form-data"))
      await this.auth.limitAttempts(`material-upload:${user.id}`, 30, 900);
    return true;
  }
}

// Svaki formular šalje najviše jedan PDF i ograničen broj kratkih tekstualnih polja.
const uploadOptions = {
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 10,
    parts: 11,
    fieldSize: 40000,
  },
};

/** Sve adrese su privatne; ne izlaže fajlove kroz javni folder ili javni katalog. */
@Controller("client-materials")
@UseGuards(AuthOriginGuard, MaterialsSessionGuard)
export class MaterialsController {
  /** Povezuje HTTP radnje sa vlasničkim provjerama servisa. */
  constructor(
    @Inject(MaterialsService) private readonly materials: MaterialsService,
  ) {}

  /** Vraća vlastite zadatke i, samo terapeutu, njegove klijente za dodjelu. */
  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Req() request: Request) {
    return this.materials.list(sessionToken(request));
  }

  /** Prima uputstvo/link i opcioni PDF, pa ih zajedno čuva za jednog klijenta. */
  @Post()
  @Header("Cache-Control", "private, no-store")
  @UseInterceptors(FileInterceptor("file", uploadOptions))
  create(
    @Req() request: Request,
    @Body() body: unknown,
    @UploadedFile() file: MaterialUpload | undefined,
  ) {
    return this.materials.save(sessionToken(request), body, file);
  }

  /** Uređuje samo vlastiti materijal; primalac ostaje onaj kome je prvobitno dodijeljen. */
  @Post(":id/update")
  @Header("Cache-Control", "private, no-store")
  @UseInterceptors(FileInterceptor("file", uploadOptions))
  update(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @UploadedFile() file: MaterialUpload | undefined,
  ) {
    return this.materials.save(sessionToken(request), body, file, id);
  }

  /** Povlači materijal iz pregleda i zatvara njegovo preuzimanje. */
  @Post(":id/archive")
  @Header("Cache-Control", "private, no-store")
  archive(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.materials.archive(sessionToken(request), id, body);
  }

  /** Šalje PDF kao prilog tek nakon nove provjere naloga i vlasništva. */
  @Get(":id/file")
  async download(
    @Req() request: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.materials.download(sessionToken(request), id);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "sandbox");
    return new StreamableFile(file.data, {
      type: "application/pdf",
      length: file.data.length,
      disposition: `attachment; filename="materijal.pdf"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    });
  }
}
