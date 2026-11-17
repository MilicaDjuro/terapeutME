import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
  UseGuards,
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Post,
  Delete,
  UploadedFile,
  UseInterceptors,
  Req,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { DirectoryService } from "./directory.service";
import { PhotosService, type PhotoUpload } from "./photos.service";
import { AuthOriginGuard, sessionToken } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";

/** Izlaže samo aktivne javne profile iz baze. */
@Controller("therapists")
export class DirectoryController {
  /** Povezuje HTTP prikaz sa čitanjem PostgreSQL kataloga. */
  constructor(
    @Inject(DirectoryService) private readonly directory: DirectoryService,
  ) {}
  /** Vraća aktuelni katalog, bez lokalnog cache-a privatnih naloga. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list() {
    return { therapists: await this.directory.list() };
  }
  /** Pronalazi javni profil po stabilnoj oznaci; stari URL-ovi probnih profila ostaju važeći. */
  @Get(":id")
  @Header("Cache-Control", "no-store")
  async profile(@Param("id") id: string) {
    const profile = (await this.directory.list()).find(
      (therapist) => therapist.id === id,
    );
    if (!profile) throw new NotFoundException("Profil nije dostupan.");
    return { therapist: profile };
  }
}

/** Provjerava sesiju prije parsiranja upload-a, da anonimni korisnik ne zauzima memoriju slikom. */
@Injectable()
export class PhotoSessionGuard implements CanActivate {
  /** Koristi postojeću serversku provjeru sesije i suspenzije. */
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  /** Dozvoljava obradu datoteke samo prijavljenom terapeutu. */
  async canActivate(context: ExecutionContext) {
    const user = await this.auth.getAccount(
      sessionToken(context.switchToHttp().getRequest<Request>()),
    );
    if (user.role !== "THERAPIST")
      throw new ForbiddenException("Fotografije može mijenjati samo terapeut.");
    return true;
  }
}

/** Čuva fotografije samo vlastitog profila; uloga i vlasništvo ostaju na serveru. */
@Controller("auth/therapist-profile/photos")
@UseGuards(AuthOriginGuard, PhotoSessionGuard)
export class OwnPhotosController {
  /** Povezuje HTTP radnje sa provjerenim čuvanjem fotografija. */
  constructor(@Inject(PhotosService) private readonly photos: PhotosService) {}
  /** Prima jednu ograničenu sliku; MIME naziv sam nije dokaz da je sadržaj fotografija. */
  @Post()
  @UseInterceptors(
    FileInterceptor("photo", {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    }),
  )
  upload(
    @Req() request: Request,
    @UploadedFile() file: PhotoUpload | undefined,
  ) {
    return this.photos.upload(sessionToken(request), file);
  }
  /** Postavlja vlastitu sliku za profilnu fotografiju u katalogu. */
  @Post(":id/primary")
  primary(@Req() request: Request, @Param("id") id: string) {
    return this.photos.change(sessionToken(request), id, "primary");
  }
  /** Briše samo sliku vlasnika sesije i po potrebi bira novu profilnu fotografiju. */
  @Delete(":id")
  remove(@Req() request: Request, @Param("id") id: string) {
    return this.photos.change(sessionToken(request), id, "delete");
  }
}

/** Šalje isključivo provjereni WebP iz baze, bez putanja datoteka koje je korisnik zadao. */
@Controller("therapist-photos")
export class PublicPhotosController {
  /** Prima servis koji provjerava javnu aktivnost i suspenziju profila. */
  constructor(@Inject(PhotosService) private readonly photos: PhotosService) {}
  /** Fotografije su javne dok je profil aktivan; brisanje nije skriveno dugim cache-om. */
  @Get(":id")
  async image(
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.photos.read(id);
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    return new StreamableFile(data);
  }
}
