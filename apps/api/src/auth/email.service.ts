import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";
import { configuredEmailMode } from "../config";

/** Dijeli jednu dostavu za kodove, reset i outbox; Resend koristi HTTPS, a Mailpit samo lokalni SMTP. */
@Injectable()
export class EmailService {
  readonly mode = configuredEmailMode();
  private readonly transporter =
    this.mode === "local" || this.mode === "smtp"
      ? nodemailer.createTransport({
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
        })
      : undefined;

  /** Zaustavlja email radnju prije čuvanja privremenih podataka; nikad ne prikazuje lažno uspješno slanje. */
  assertDeliveryEnabled() {
    if (this.mode === "disabled") {
      throw new ServiceUnavailableException(
        "Slanje emaila još nije uključeno. Pokušajte kasnije.",
      );
    }
  }

  /** Šalje jednu tekstualnu poruku; samo outbox dobija stabilan Resend ključ protiv duplikata. */
  private async sendMessage(
    email: string,
    subject: string,
    text: string,
    outboxId?: string,
  ) {
    this.assertDeliveryEnabled();
    if (this.mode === "resend") {
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        };
        if (outboxId) headers["Idempotency-Key"] = `booking/${outboxId}`;
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers,
          body: JSON.stringify({
            from: process.env.RESEND_FROM,
            to: [email],
            subject,
            text,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("Resend je odbio poruku.");
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("id" in result) ||
          typeof result.id !== "string" ||
          !result.id.trim()
        ) {
          throw new Error("Resend nije potvrdio prihvatanje poruke.");
        }
      } catch {
        // Odgovor provajdera može sadržati kontakt ili tajnu; čuvamo samo bezbjednu oznaku.
        throw Object.assign(
          new Error("Resend dostava trenutno nije uspjela."),
          { code: "RESEND_SEND_FAILED" },
        );
      }
      return;
    }
    if (!this.transporter) throw new Error("Email dostava nije podešena.");
    const result = await this.transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject,
      text,
      messageId: outboxId
        ? `<booking-${outboxId}@notifications.terapeut.me>`
        : undefined,
    });
    if (!result.accepted.length || result.rejected.length) {
      throw new Error("SMTP nije prihvatio poruku.");
    }
  }

  /** Šalje obavještenje iz outbox-a; isti ID poruke ostaje i pri ponovnom pokušaju. */
  async sendBookingNotification(
    email: string,
    subject: string,
    text: string,
    outboxId: string,
  ) {
    await this.sendMessage(email, subject, text, outboxId);
  }

  /** Šalje četvorocifreni kod; ne ispisuje ga u logove niti vraća browseru. */
  async sendRegistrationCode(email: string, code: string) {
    await this.sendMessage(
      email,
      "Terapeut.me — kod za potvrdu emaila",
      `Vaš kod za registraciju na Terapeut.me je: ${code}\n\nKod važi najviše 10 minuta. Ako nijeste pokrenuli registraciju, zanemarite ovu poruku.`,
    );
  }

  /** Šalje jednokratni link; JWT ostaje u emailu i ne ispisuje se u logove. */
  async sendPasswordResetLink(email: string, link: string) {
    await this.sendMessage(
      email,
      "Terapeut.me — obnova lozinke",
      `Za unos nove lozinke otvorite ovaj link:\n\n${link}\n\nLink važi 15 minuta i može se iskoristiti jednom. Ako nijeste tražili obnovu, zanemarite poruku. Vaša lozinka ostaje nepromijenjena dok ne završite obnovu.`,
    );
  }
}
