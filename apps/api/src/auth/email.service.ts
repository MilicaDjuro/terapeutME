import { Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";

/** Šalje potvrdu preko SMTP-a; lokalni Mailpit služi samo za razvoj i testove. */
@Injectable()
export class EmailService {
  readonly mode = process.env.AUTH_EMAIL_MODE === "smtp" ? "smtp" : "local";
  private readonly transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: this.mode === "smtp",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  /** Šalje obavještenje iz outbox-a; isti ID poruke ostaje i pri ponovnom pokušaju. */
  async sendBookingNotification(
    email: string,
    subject: string,
    text: string,
    outboxId: string,
  ) {
    const result = await this.transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject,
      text,
      messageId: `<booking-${outboxId}@notifications.terapeut.me>`,
    });
    if (!result.accepted.length || result.rejected.length)
      throw new Error("SMTP nije prihvatio booking obavještenje.");
  }

  /** Šalje četvorocifreni kod; ne ispisuje ga u logove niti vraća browseru. */
  async sendRegistrationCode(email: string, code: string) {
    const result = await this.transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: "Terapeut.me — kod za potvrdu emaila",
      text: `Vaš kod za registraciju na Terapeut.me je: ${code}\n\nKod važi najviše 10 minuta. Ako nijeste pokrenuli registraciju, zanemarite ovu poruku.`,
    });
    if (!result.accepted.length || result.rejected.length)
      throw new Error("SMTP nije prihvatio poruku.");
  }

  /** Šalje jednokratni link; JWT ostaje u emailu i ne ispisuje se u logove. */
  async sendPasswordResetLink(email: string, link: string) {
    const result = await this.transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: "Terapeut.me — obnova lozinke",
      text: `Za unos nove lozinke otvorite ovaj link:\n\n${link}\n\nLink važi 15 minuta i može se iskoristiti jednom. Ako nijeste tražili obnovu, zanemarite poruku. Vaša lozinka ostaje nepromijenjena dok ne završite obnovu.`,
    });
    if (!result.accepted.length || result.rejected.length)
      throw new Error("SMTP nije prihvatio poruku.");
  }
}
