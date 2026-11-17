import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import sharp from "sharp";
import { DatabaseService } from "../database.service";
import { AuthService } from "../auth/auth.service";
import { photoView } from "./directory.types";

export interface PhotoUpload {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

/** Provjerava sadržaj slike i pravi ograničeni WebP bez EXIF podataka ili izvršivog sadržaja. */
export async function normalizePhoto(file: PhotoUpload | undefined) {
  if (
    !file ||
    file.size > 5 * 1024 * 1024 ||
    file.buffer.length > 5 * 1024 * 1024 ||
    !file.buffer.length
  )
    throw new BadRequestException("Izaberite fotografiju do 5 MB.");
  const bytes = file.buffer;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP";
  if (!jpeg && !png && !webp)
    throw new BadRequestException("Podržane su JPEG, PNG i WebP fotografije.");
  try {
    const image = sharp(file.buffer, {
      limitInputPixels: 16000000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages || 1) > 1
    )
      throw new Error("Unsupported image");
    return await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new BadRequestException(
      "Datoteka mora biti ispravna JPEG, PNG ili WebP fotografija.",
    );
  }
}

/** Čuva slike u bazi i sve izmjene provjerava prema vlasniku serverske sesije. */
@Injectable()
export class PhotosService {
  /** Dijeli postojeću bazu i provjeru sesije; ne prima korisnički ID kao dokaz vlasništva. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Provjerava ulogu i vraća ID vlasnika za sljedeće SQL provjere. */
  private async ownerId(token: string | undefined) {
    const user = await this.auth.getAccount(token);
    if (user.role !== "THERAPIST")
      throw new ForbiddenException("Fotografije može mijenjati samo terapeut.");
    return user.id;
  }

  /** Zaključava samo vlastiti profil; paralelno slanje ne zaobilazi broj slika ili profilnu sliku. */
  private async lockProfile(client: PoolClient, ownerId: string) {
    const result = await client.query<{ id: string }>(
      "SELECT t.id FROM therapists t JOIN users u ON u.id=t.linked_user_id WHERE t.linked_user_id=$1 AND u.role='THERAPIST' AND u.suspended_at IS NULL FOR UPDATE OF t",
      [ownerId],
    );
    if (!result.rows[0])
      throw new ForbiddenException("Terapeutski profil nije dostupan.");
    return result.rows[0].id;
  }

  /** Dodaje najviše osam fotografija; prva automatski postaje profilna. */
  async upload(token: string | undefined, file: PhotoUpload | undefined) {
    const ownerId = await this.ownerId(token);
    await this.auth.limitAttempts(`photo:${ownerId}`, 30, 900);
    const image = await normalizePhoto(file);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.lockProfile(client, ownerId);
      const count = await client.query<{ count: string }>(
        "SELECT count(*) FROM therapist_photos WHERE therapist_id=$1",
        [therapistId],
      );
      if (Number(count.rows[0].count) >= 8)
        throw new BadRequestException(
          "Možete sačuvati najviše osam fotografija.",
        );
      const result = await client.query<{ id: string; is_primary: boolean }>(
        "INSERT INTO therapist_photos (therapist_id,image_data,width,height,is_primary) VALUES ($1,$2,$3,$4,$5) RETURNING id,is_primary",
        [
          therapistId,
          image.data,
          image.info.width,
          image.info.height,
          count.rows[0].count === "0",
        ],
      );
      await client.query("COMMIT");
      return photoView(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Mijenja ili briše samo vlastitu sliku; tuđi ID ne daje pravo na izmjenu. */
  async change(
    token: string | undefined,
    photoId: string,
    action: "primary" | "delete",
  ) {
    const ownerId = await this.ownerId(token);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const therapistId = await this.lockProfile(client, ownerId);
      const photo = await client.query<{ is_primary: boolean }>(
        "SELECT is_primary FROM therapist_photos WHERE id::text=$1 AND therapist_id=$2",
        [photoId, therapistId],
      );
      if (!photo.rows[0])
        throw new NotFoundException("Fotografija nije pronađena.");
      if (action === "primary") {
        await client.query(
          "UPDATE therapist_photos SET is_primary=false WHERE therapist_id=$1",
          [therapistId],
        );
        await client.query(
          "UPDATE therapist_photos SET is_primary=true WHERE id::text=$1 AND therapist_id=$2",
          [photoId, therapistId],
        );
      } else {
        await client.query(
          "DELETE FROM therapist_photos WHERE id::text=$1 AND therapist_id=$2",
          [photoId, therapistId],
        );
        if (photo.rows[0].is_primary)
          await client.query(
            "UPDATE therapist_photos SET is_primary=true WHERE id=(SELECT id FROM therapist_photos WHERE therapist_id=$1 ORDER BY created_at,id LIMIT 1)",
            [therapistId],
          );
      }
      await client.query("COMMIT");
      return { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Vraća sliku samo javno aktivnog profila; za obrisane/suspendovane profile vraća 404. */
  async read(photoId: string): Promise<Buffer> {
    const result = await this.database.pool.query<{ image_data: Buffer }>(
      "SELECT p.image_data FROM therapist_photos p JOIN therapists t ON t.id=p.therapist_id LEFT JOIN users u ON u.id=t.linked_user_id WHERE p.id::text=$1 AND t.is_active AND u.suspended_at IS NULL",
      [photoId],
    );
    if (!result.rows[0])
      throw new NotFoundException("Fotografija nije dostupna.");
    return result.rows[0].image_data;
  }
}
