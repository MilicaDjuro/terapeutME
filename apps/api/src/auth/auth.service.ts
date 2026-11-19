import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database.service";
import { EmailService } from "./email.service";
import { photoView } from "../directory/directory.types";
import { validateTherapistProfile } from "./auth.validation";
import {
  hashPassword,
  hashToken,
  matchesHash,
  privateHash,
  verifyPassword,
} from "./auth.crypto";
import type {
  AccountProfileInput,
  AccountUser,
  RegistrationInput,
  RegistrationRow,
  UserRow,
  TherapistRegistrationDetails,
  TherapistDetailsRow,
  TherapistAccountProfile,
  TherapistProfileInput,
} from "./auth.types";

import {
  createSessionToken,
  verifySessionToken,
  SESSION_SECONDS,
} from "./auth.jwt";
export { SESSION_SECONDS } from "./auth.jwt";
export const SESSION_COOKIE = "terapeut_session";
export const USER_COLUMNS =
  "id, email, first_name, last_name, date_of_birth::text, phone, city, address, role, password_hash, verified_at, suspended_at";

/** Određuje kategoriju kataloga iz zvanja; ne dodjeljuje stručnu verifikaciju. */
function therapistProfession(title: string): string {
  const normalizedTitle = title.toLowerCase();
  if (normalizedTitle.includes("psihijatr")) return "psychiatrist";
  if (
    normalizedTitle.includes("psiholog") ||
    normalizedTitle.includes("psihološ")
  )
    return "psychologist";
  return "psychotherapist";
}

/** Vraća samo javna polja vlastitog naloga, bez lozinke i sesije. */
export function accountUser(row: UserRow): AccountUser {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    city: row.city,
    address: row.address,
    role: row.role,
  };
}

/** Vodi registraciju, potvrdu i sesije; sve odluke o identitetu donosi server. */
@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** Prima jednu zajedničku bazu i SMTP servis; eksplicitni Inject radi i u tsx razvoju. */
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  /** Pokreće čišćenje privremenih podataka; SQL rokovi važe i kada timer ne radi. */
  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredData().catch(() =>
        console.error("Čišćenje auth podataka nije uspjelo."),
      );
    }, 60000);
    this.cleanupTimer.unref();
  }

  /** Uklanja timer pri gašenju API-ja da ne zadržava proces. */
  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /** Briše istekle sesije/ograničenja i registracije starije od jednog dana. */
  async cleanupExpiredData() {
    await this.database.pool.query(
      "DELETE FROM auth_sessions WHERE expires_at < now(); DELETE FROM auth_rate_limits WHERE reset_at < now(); DELETE FROM registration_challenges WHERE created_at < now() - interval '1 day'; DELETE FROM password_reset_tokens WHERE expires_at < now()",
    );
  }

  /** Atomski broji pokušaje u bazi; restart i paralelni zahtjevi ne zaobilaze limit. */
  async limitAttempts(key: string, maximum: number, windowSeconds: number) {
    const result = await this.database.pool.query<{ attempts: number }>(
      `INSERT INTO auth_rate_limits (key_hash, attempts, reset_at) VALUES ($1, 1, now() + $2 * interval '1 second')
       ON CONFLICT (key_hash) DO UPDATE SET
         attempts = CASE WHEN auth_rate_limits.reset_at <= now() THEN 1 ELSE auth_rate_limits.attempts + 1 END,
         reset_at = CASE WHEN auth_rate_limits.reset_at <= now() THEN excluded.reset_at ELSE auth_rate_limits.reset_at END
       RETURNING attempts`,
      [privateHash(key), windowSeconds],
    );
    if (result.rows[0].attempts > maximum)
      throw new HttpException(
        "Previše pokušaja. Sačekajte prije ponovnog pokušaja.",
        429,
      );
  }

  /** Serijalizuje promjene iste email adrese u svim API instancama. */
  private async lockEmail(client: PoolClient, email: string) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [email],
    );
  }

  /** Kreira novi privremeni zahtjev; postojeći aktivni zahtjev ne smije biti preuzet. */
  async startRegistration(
    input: RegistrationInput,
    therapistProfile?: TherapistRegistrationDetails,
  ) {
    this.email.assertDeliveryEnabled();
    await this.limitAttempts(`register:${input.email}`, 5, 3600);
    const passwordHash = await hashPassword(input.password);
    const id = randomUUID();
    const code = randomInt(0, 10000).toString().padStart(4, "0");
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockEmail(client, input.email);
      const existingUser = await client.query(
        "SELECT id FROM users WHERE lower(email) = $1",
        [input.email],
      );
      if (existingUser.rowCount)
        throw new ConflictException(
          "Nalog sa ovom email adresom već postoji. Prijavite se.",
        );
      const previous = await client.query<RegistrationRow>(
        "SELECT * FROM registration_challenges WHERE email = $1 FOR UPDATE",
        [input.email],
      );
      if (
        previous.rows[0] &&
        previous.rows[0].expires_at.getTime() > Date.now()
      ) {
        throw new ConflictException(
          "Registracija je već započeta. Unesite poslati kod ili sačekajte da istekne.",
        );
      }
      await client.query(
        "DELETE FROM registration_challenges WHERE email = $1",
        [input.email],
      );
      await client.query(
        `INSERT INTO registration_challenges (id, email, first_name, last_name, date_of_birth, password_hash, code_hash, registration_role, expires_at, next_send_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now() + interval '10 minutes',now() + interval '60 seconds')`,
        [
          id,
          input.email,
          input.firstName,
          input.lastName,
          input.dateOfBirth,
          passwordHash,
          privateHash(`${id}:${code}`),
          therapistProfile ? "THERAPIST" : "CLIENT",
        ],
      );
      if (therapistProfile) {
        // Privremeni profil još nije nalog; potvrda kasnije čuva korisnika, profil i uslugu odjednom.
        await client.query(
          `INSERT INTO therapist_registration_details (challenge_id,title,biography,city,address,phone,service_name,duration_minutes,price_eur)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            therapistProfile.title,
            therapistProfile.biography,
            therapistProfile.city,
            therapistProfile.address,
            therapistProfile.phone,
            therapistProfile.serviceName,
            therapistProfile.durationMinutes,
            therapistProfile.priceEur,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    try {
      await this.deliverCode(id, input.email, code);
    } catch (error) {
      // Ne ostavljamo nedostupan prvi korak ako SMTP slanje nije uspjelo.
      await this.database.pool.query(
        "DELETE FROM registration_challenges WHERE id = $1 AND sent_at IS NULL",
        [id],
      );
      throw error;
    }
    return {
      challengeId: id,
      delivery: this.email.mode,
      resendAfterSeconds: 60,
    };
  }

  /** Potvrđuje SMTP prihvatanje tek nakon slanja; kvar slanja nije lažna potvrda korisniku. */
  private async deliverCode(id: string, email: string, code: string) {
    try {
      await this.email.sendRegistrationCode(email, code);
      await this.database.pool.query(
        "UPDATE registration_challenges SET sent_at = now() WHERE id = $1 AND code_hash = $2",
        [id, privateHash(`${id}:${code}`)],
      );
    } catch {
      throw new ServiceUnavailableException(
        "Kod nije moguće poslati. Pokušajte ponovo kasnije.",
      );
    }
  }

  /** Izdaje novi kod za isti zahtjev; prethodni kod prestaje da važi, broj grešaka ostaje. */
  async resendCode(id: string) {
    this.email.assertDeliveryEnabled();
    await this.limitAttempts(`resend:${id}`, 5, 3600);
    let code = randomInt(0, 10000).toString().padStart(4, "0");
    const client = await this.database.pool.connect();
    let recipient = "";
    try {
      await client.query("BEGIN");
      const result = await client.query<RegistrationRow>(
        "SELECT * FROM registration_challenges WHERE id = $1 FOR UPDATE",
        [id],
      );
      const challenge = result.rows[0];
      if (!challenge)
        throw new BadRequestException(
          "Registracija je istekla. Ponovo unesite podatke.",
        );
      if (
        challenge.failed_attempts >= 5 ||
        challenge.created_at.getTime() + 30 * 60000 <= Date.now()
      )
        throw new BadRequestException(
          "Registracija je zaključana. Sačekajte istek i ponovo unesite podatke.",
        );
      if (challenge.next_send_at.getTime() > Date.now())
        throw new HttpException(
          "Novi kod možete zatražiti nakon 60 sekundi.",
          429,
        );
      // Nasumičan novi kod mora se razlikovati od prethodnog, uključujući vodeće nule.
      while (matchesHash(challenge.code_hash, privateHash(`${id}:${code}`))) {
        code = randomInt(0, 10000).toString().padStart(4, "0");
      }
      recipient = challenge.email;
      await client.query(
        "UPDATE registration_challenges SET code_hash = $2, sent_at = NULL, expires_at = LEAST(now() + interval '10 minutes', created_at + interval '30 minutes'), next_send_at = now() + interval '60 seconds' WHERE id = $1",
        [id, privateHash(`${id}:${code}`)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.deliverCode(id, recipient, code);
    return { delivery: this.email.mode, resendAfterSeconds: 60 };
  }

  /** Čuva hash potpisanog JWT-a radi opoziva; potvrda naloga koristi istu transakciju. */
  async createSession(client: PoolClient, user: AccountUser): Promise<string> {
    const token = createSessionToken(user);
    await client.query(
      "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,now() + $3 * interval '1 second')",
      [hashToken(token), user.id, SESSION_SECONDS],
    );
    return token;
  }

  /** U istoj transakciji kreira povezani profil i prvu uslugu; email potvrda ne verifikuje struku. */
  private async createTherapistProfile(
    client: PoolClient,
    user: AccountUser,
    details: TherapistDetailsRow,
  ) {
    // Kategorija za pretragu prati uneseno zvanje; email potvrda ne mijenja stručnu verifikaciju.
    const profession = therapistProfession(details.title);
    const profile = await client.query<{ id: string }>(
      `INSERT INTO therapists (linked_user_id,full_name,title_mne,title_en,bio_mne,bio_en,city,address,is_verified,profession)
       VALUES ($1,$2,$3,$3,$4,$4,$5,$6,false,$7) RETURNING id`,
      [
        user.id,
        `${user.firstName} ${user.lastName}`,
        details.title,
        details.biography,
        details.city,
        details.address,
        profession,
      ],
    );
    // Engleski tekst privremeno koristi isti unos; nema izmišljenog automatskog prevoda.
    await client.query(
      `INSERT INTO services (therapist_id,name_mne,name_en,duration_minutes,price_eur) VALUES ($1,$2,$2,$3,$4)`,
      [
        profile.rows[0].id,
        details.service_name,
        details.duration_minutes,
        details.price_eur,
      ],
    );
  }

  /** Zaključava zahtjev, troši pokušaj i pravi nalog/sesiju samo uz važeći kod. */
  async verifyRegistration(id: string, code: string) {
    await this.limitAttempts(`verify:${id}`, 10, 900);
    const client = await this.database.pool.connect();
    let failure = "";
    let user: AccountUser | undefined;
    let token = "";
    try {
      await client.query("BEGIN");
      // Redoslijed zaključavanja je isti kao u register: prvo email, zatim zahtjev.
      const identity = await client.query<{ email: string }>(
        "SELECT email FROM registration_challenges WHERE id = $1",
        [id],
      );
      if (identity.rows[0])
        await this.lockEmail(client, identity.rows[0].email);
      const result = await client.query<RegistrationRow>(
        "SELECT *, date_of_birth::text FROM registration_challenges WHERE id = $1 FOR UPDATE",
        [id],
      );
      const challenge = result.rows[0];
      if (
        !challenge ||
        challenge.expires_at.getTime() <= Date.now() ||
        !challenge.sent_at
      ) {
        failure = "Kod je istekao ili nije poslat. Zatražite novi kod.";
      } else if (challenge.failed_attempts >= 5) {
        failure =
          "Iskorišćeno je pet pokušaja. Sačekajte istek i započnite novu registraciju.";
      } else if (
        !matchesHash(challenge.code_hash, privateHash(`${id}:${code}`))
      ) {
        await client.query(
          "UPDATE registration_challenges SET failed_attempts = failed_attempts + 1 WHERE id = $1",
          [id],
        );
        failure = "Kod nije tačan. Provjerite poruku i pokušajte ponovo.";
      } else {
        if (
          challenge.registration_role !== "CLIENT" &&
          challenge.registration_role !== "THERAPIST"
        )
          throw new BadRequestException("Vrsta registracije nije dozvoljena.");
        let therapistDetails: TherapistDetailsRow | undefined;
        if (challenge.registration_role === "THERAPIST") {
          const details = await client.query<TherapistDetailsRow>(
            "SELECT * FROM therapist_registration_details WHERE challenge_id = $1",
            [id],
          );
          therapistDetails = details.rows[0];
          if (!therapistDetails)
            throw new BadRequestException(
              "Podaci terapeuta nijesu sačuvani. Ponovite registraciju.",
            );
        }
        const created = await client.query<UserRow>(
          `INSERT INTO users (email, password_hash, full_name, first_name, last_name, date_of_birth, role, phone, verified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING ${USER_COLUMNS}`,
          [
            challenge.email,
            challenge.password_hash,
            `${challenge.first_name} ${challenge.last_name}`,
            challenge.first_name,
            challenge.last_name,
            challenge.date_of_birth,
            challenge.registration_role,
            therapistDetails?.phone || null,
          ],
        );
        user = accountUser(created.rows[0]);
        if (therapistDetails)
          await this.createTherapistProfile(client, user, therapistDetails);
        token = await this.createSession(client, user);
        await client.query(
          "DELETE FROM registration_challenges WHERE id = $1",
          [id],
        );
      }
      // Pogrešan kod mora ostati evidentiran čak i kada se browseru vraća greška.
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new ConflictException("Nalog sa ovom email adresom već postoji.");
      throw error;
    } finally {
      client.release();
    }
    if (failure || !user)
      throw new BadRequestException(failure || "Registracija nije potvrđena.");
    return { user, token };
  }

  /** Provjerava email/lozinku bez otkrivanja koji podatak je pogrešan. */
  async login(email: string, password: string) {
    await this.limitAttempts(`login:${email}`, 10, 900);
    const result = await this.database.pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = $1`,
      [email],
    );
    const user = result.rows[0];
    const valid = await verifyPassword(password, user?.password_hash || null);
    if (!valid || !user || !user.verified_at || user.suspended_at)
      throw new UnauthorizedException("Email ili lozinka nijesu ispravni.");
    const client = await this.database.pool.connect();
    try {
      const token = await this.createSession(client, accountUser(user));
      return { user: accountUser(user), token };
    } finally {
      client.release();
    }
  }

  /** Čita isključivo vlasnika važeće sesije; uloga i suspenzija dolaze iz baze. */
  async getAccount(token: string | undefined): Promise<AccountUser> {
    const claims = verifySessionToken(token);
    const result = await this.database.pool.query<UserRow>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.date_of_birth::text, u.phone, u.city, u.address, u.role, u.password_hash, u.verified_at, u.suspended_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND u.id = $2 AND s.expires_at > now() AND u.verified_at IS NOT NULL AND u.suspended_at IS NULL`,
      [hashToken(token!), claims.sub],
    );
    if (!result.rows[0] || result.rows[0].role !== claims.role)
      throw new UnauthorizedException(
        "Sesija je istekla. Prijavite se ponovo.",
      );
    return accountUser(result.rows[0]);
  }

  /** Čuva cijeli profil jednom transakcijom; klijentov kontakt ostaje privatan, a ordinacija javna. */
  async updateAccountProfile(
    token: string | undefined,
    input: AccountProfileInput,
  ) {
    const user = await this.getAccount(token);
    const fullName = `${input.firstName} ${input.lastName}`;
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      // Isti redosljed kao profesionalni profil: prvo therapists, zatim users, bez tuđeg ID-a.
      if (user.role === "THERAPIST") {
        const current = await client.query<{
          title_mne: string;
          bio_mne: string;
          city: string;
          address: string | null;
        }>(
          "SELECT title_mne,bio_mne,city,address FROM therapists WHERE linked_user_id=$1 FOR UPDATE",
          [user.id],
        );
        if (!current.rowCount)
          throw new BadRequestException("Terapeutski profil nije pronađen.");
        const stored = current.rows[0];
        // Izostavljena polja zadržavaju postojeću vrijednost. Terapeutu su telefon i grad obavezni.
        const professional = validateTherapistProfile({
          title: input.title ?? stored.title_mne,
          biography: input.biography ?? stored.bio_mne,
          city: input.city !== undefined ? input.city : stored.city,
          address: input.address !== undefined ? input.address : stored.address,
          phone: input.phone !== undefined ? input.phone : user.phone,
        });
        await client.query(
          `UPDATE therapists SET full_name=$2,title_mne=$3,title_en=$3,bio_mne=$4,bio_en=$4,
             city=$5,address=$6,profession=$7,updated_at=now() WHERE linked_user_id=$1`,
          [
            user.id,
            fullName,
            professional.title,
            professional.biography,
            professional.city,
            professional.address,
            therapistProfession(professional.title),
          ],
        );
      }
      const result = await client.query<UserRow>(
        `UPDATE users SET first_name=$2,last_name=$3,full_name=$4,date_of_birth=$5,
           phone=CASE WHEN $6::boolean THEN $7::text ELSE phone END,
           city=CASE WHEN role='CLIENT' AND $8::boolean THEN $9::text ELSE city END,
           address=CASE WHEN role='CLIENT' AND $10::boolean THEN $11::text ELSE address END,updated_at=now()
         WHERE id=$1 RETURNING ${USER_COLUMNS}`,
        [
          user.id,
          input.firstName,
          input.lastName,
          fullName,
          input.dateOfBirth,
          input.phone !== undefined,
          input.phone ?? null,
          input.city !== undefined,
          input.city ?? null,
          input.address !== undefined,
          input.address ?? null,
        ],
      );
      if (!result.rowCount)
        throw new UnauthorizedException("Nalog nije dostupan.");
      await client.query("COMMIT");
      // Odgovor sadrži stvarno sačuvan red; browser tek sada mijenja svoj prikaz naloga.
      return accountUser(result.rows[0]);
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  /** Čita samo profil vlasnika terapeutske sesije; ID iz browsera ne daje pristup tuđem profilu. */
  async getTherapistProfile(
    token: string | undefined,
  ): Promise<TherapistAccountProfile> {
    const user = await this.getAccount(token);
    if (user.role !== "THERAPIST")
      throw new ForbiddenException("Ovaj prikaz je dostupan samo terapeutu.");
    const result = await this.database.pool.query<{
      id: string;
      public_id: string | null;
      full_name: string;
      title_mne: string;
      bio_mne: string | null;
      city: string;
      address: string | null;
      phone: string | null;
      is_verified: boolean;
    }>(
      `SELECT t.id,t.public_id,t.full_name,t.title_mne,t.bio_mne,t.city,t.address,t.is_verified,u.phone
        FROM therapists t JOIN users u ON u.id = t.linked_user_id WHERE t.linked_user_id = $1`,
      [user.id],
    );
    const profile = result.rows[0];
    if (!profile)
      throw new BadRequestException("Terapeutski profil nije pronađen.");
    const services = await this.database.pool.query<{
      id: string;
      name_mne: string;
      duration_minutes: number;
      price_eur: string | null;
    }>(
      "SELECT id,name_mne,duration_minutes,price_eur FROM services WHERE therapist_id = $1 AND is_active ORDER BY duration_minutes DESC,created_at,id",
      [profile.id],
    );
    const photos = await this.database.pool.query<{
      id: string;
      is_primary: boolean;
    }>(
      "SELECT id,is_primary FROM therapist_photos WHERE therapist_id=$1 ORDER BY is_primary DESC,created_at,id",
      [profile.id],
    );
    return {
      id: profile.id,
      publicId: profile.public_id || profile.id,
      photos: photos.rows.map(photoView),
      name: profile.full_name,
      title: profile.title_mne,
      biography: profile.bio_mne || "",
      city: profile.city,
      address: profile.address,
      phone: profile.phone,
      verified: profile.is_verified,
      services: services.rows.map((service) => ({
        id: service.id,
        name: service.name_mne,
        durationMinutes: service.duration_minutes,
        priceEur: service.price_eur === null ? null : Number(service.price_eur),
      })),
    };
  }

  /** Čuva samo vlastiti profil i kontakt u jednoj transakciji; usluge i istorija ostaju sačuvane. */
  async updateTherapistProfile(
    token: string | undefined,
    input: TherapistProfileInput,
  ) {
    const user = await this.getAccount(token);
    if (user.role !== "THERAPIST")
      throw new ForbiddenException("Profil može mijenjati samo terapeut.");
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      // Vlasnik dolazi iz JWT sesije; formular ne određuje ID profila niti verifikaciju.
      const updated = await client.query(
        `UPDATE therapists SET title_mne=$2,title_en=$2,bio_mne=$3,bio_en=$3,city=$4,address=$5,profession=$6,updated_at=now()
         WHERE linked_user_id=$1 RETURNING id`,
        [
          user.id,
          input.title,
          input.biography,
          input.city,
          input.address,
          therapistProfession(input.title),
        ],
      );
      if (!updated.rowCount)
        throw new BadRequestException("Terapeutski profil nije pronađen.");
      await client.query(
        "UPDATE users SET phone=$2,updated_at=now() WHERE id=$1",
        [user.id, input.phone],
      );
      await client.query("COMMIT");
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
    return this.getTherapistProfile(token);
  }

  /** Opoziva sesiju na serveru; kopija starog kolačića više ne omogućava prijavu. */
  async logout(token: string | undefined) {
    if (token)
      await this.database.pool.query(
        "DELETE FROM auth_sessions WHERE token_hash = $1",
        [hashToken(token)],
      );
  }
}
