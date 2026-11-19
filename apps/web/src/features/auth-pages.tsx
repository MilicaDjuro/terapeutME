"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { useDemo } from "@/lib/demo-context";
import { useAuth } from "@/lib/auth-context";
import { accountHome, authErrorMessage, requestAuth } from "@/lib/auth-client";
import type { EmailDelivery } from "@/lib/auth-client";
import { TherapistRegistrationFields } from "./therapist-registration-fields";
import { useDirectory } from "@/lib/directory-context";
import { ActionButton } from "@/components/ui";

const PENDING_REGISTRATION_KEY = "terapeut-me.pending-registration.v1";

/** Pamti samo oznaku nepotvrđene registracije i email u ovom tabu, nikad lozinku ili kod. */
function savePendingRegistration(
  storageKey: string,
  challengeId: string,
  email: string,
  delivery: EmailDelivery,
  resendAt: number,
) {
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        challengeId,
        email,
        delivery,
        resendAt,
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* Registracija radi i ako browser zabrani privremeno skladište. */
  }
}

/** Uklanja privremenu oznaku nakon potvrde ili povratka na prvi korak. */
function clearPendingRegistration(storageKey: string) {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    /* Serverska sesija ne zavisi od ovog skladišta. */
  }
}

/** Prikazuje zajednički okvir formulara usklađen sa bojama i tipografijom sajta. */
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { translate } = useDemo();
  return (
    <div className="container auth-page">
      <aside className="auth-intro">
        <span className="eyebrow">TERAPEUT.ME</span>
        <h2>
          {translate(
            "Vaš prvi korak ka podršci.",
            "Your first step towards support.",
          )}
        </h2>
        <p>
          {translate(
            "Jedno mjesto za vaš nalog i naredne korake.",
            "One place for your account and next steps.",
          )}
        </p>
        <div className="auth-illustration" aria-hidden="true">
          <Image
            src="/brand/nature.webp"
            alt=""
            width={1024}
            height={1024}
            sizes="(max-width: 800px) 100vw, 450px"
            loading="eager"
          />
          <span>
            <ShieldCheck size={26} strokeWidth={1.5} />
          </span>
        </div>
        <Link className="text-link" href="/psychotherapy">
          {translate("Upoznaj stručnjake", "Meet our professionals")}{" "}
          <ArrowRight size={16} />
        </Link>
      </aside>
      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title">{title}</h1>
        <p>{description}</p>
        {children}
      </section>
    </div>
  );
}

/** Prijavljuje korisnika emailom i lozinkom; odgovor API-ja uspostavlja serversku sesiju. */
export function LoginPage() {
  const { translate } = useDemo();
  const { user, setUser } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const requestInProgress = useRef(false);

  /** Šalje formular jednom i otvara početni ekran prema ulozi koju je potvrdio server. */
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInProgress.current) return;
    const values = new FormData(event.currentTarget);
    requestInProgress.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await requestAuth("login", {
        email: String(values.get("email")),
        password: String(values.get("password")),
      });
      if (!response.user) throw new Error("Nedostaje odgovor o nalogu.");
      setUser(response.user);
      router.replace(accountHome(response.user));
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      requestInProgress.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={translate("Dobro došli nazad.", "Welcome back.")}
      description={translate(
        "Prijavite se email adresom i lozinkom.",
        "Sign in with your email address and password.",
      )}
    >
      {user ? (
        <Link href={accountHome(user)} className="button button-primary">
          {translate("Nastavi", "Continue")}
        </Link>
      ) : (
        <form onSubmit={handleLogin} aria-busy={submitting}>
          <label className="field">
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label className="field">
            <span>{translate("Lozinka", "Password")}</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <ActionButton
            pending={submitting}
            className="button button-primary auth-submit"
            disabled={submitting}
          >
            {submitting
              ? translate("Prijavljivanje…", "Signing in…")
              : translate("Prijavi se", "Sign in")}
            <ArrowRight size={17} />
          </ActionButton>
        </form>
      )}
      <p className="auth-switch">
        <Link href="/forgot-password">
          {translate("Zaboravili ste lozinku?", "Forgot your password?")}
        </Link>
      </p>
      <p className="auth-switch">
        {translate("Nemate nalog?", "Don't have an account?")}{" "}
        <Link href="/register">{translate("Registrujte se", "Register")}</Link>
      </p>
      <p className="auth-switch">
        <Link href="/register/therapist">
          {translate(
            "Registracija za terapeute",
            "Registration for therapists",
          )}
        </Link>
      </p>
    </AuthLayout>
  );
}

/** Vodi dva koraka registracije; lozinka ostaje u formularu, kod se provjerava na serveru. */
export function RegistrationPage({
  therapist = false,
}: {
  therapist?: boolean;
}) {
  const { refresh: refreshDirectory } = useDirectory();
  const { translate } = useDemo();
  const { user, setUser } = useAuth();
  const router = useRouter();
  const [challengeId, setChallengeId] = useState("");
  // Pamtimo koje dugme šalje zahtjev; ostala su samo privremeno onemogućena.
  const [pendingAction, setPendingAction] = useState("");
  const [email, setEmail] = useState("");
  const [delivery, setDelivery] = useState<EmailDelivery>("smtp");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const requestInProgress = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const registrationForm = useRef<HTMLFormElement>(null);
  // Različiti ključevi sprječavaju da klijentska stranica preuzme nepotvrđen terapeutski tok.
  const pendingRegistrationKey = therapist
    ? "terapeut-me.pending-therapist-registration.v1"
    : PENDING_REGISTRATION_KEY;

  // Poslije osvježavanja taba vraćamo korak koda; konačnu važnost provjerava server.
  useEffect(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(pendingRegistrationKey) || "null",
      );
      if (
        !saved ||
        typeof saved.challengeId !== "string" ||
        typeof saved.email !== "string" ||
        typeof saved.savedAt !== "number" ||
        Date.now() - saved.savedAt > 30 * 60000
      )
        return;
      setChallengeId(saved.challengeId);
      setEmail(saved.email);
      if (saved.delivery === "resend") setDelivery("resend");
      else setDelivery(saved.delivery === "local" ? "local" : "smtp");
      setResendSeconds(
        Math.max(0, Math.ceil((saved.resendAt - Date.now()) / 1000)),
      );
    } catch {
      clearPendingRegistration(pendingRegistrationKey);
    }
  }, [pendingRegistrationKey]);

  // Fokus prelazi na kod nakon uspješnog slanja, radi korišćenja tastaturom.
  useEffect(() => {
    if (challengeId) codeInput.current?.focus();
  }, [challengeId]);
  // Odbrojavanje je samo prikaz; API ponovo provjerava rok čak i ako se browser izmijeni.
  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds(resendSeconds - 1), 1000);
    /** Uklanja prethodni timer prije novog odbrojavanja ili zatvaranja stranice. */
    function stopCountdown() {
      clearTimeout(timer);
    }
    return stopCountdown;
  }, [resendSeconds]);

  /** Šalje lične podatke i lozinku; prelazi na kod samo kada SMTP prihvati poruku. */
  async function handleRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInProgress.current) return;
    setPendingAction("register");
    const values = new FormData(event.currentTarget);
    requestInProgress.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const submittedEmail = String(values.get("email")).trim().toLowerCase();
      const registrationValues: Record<string, string> = {
        firstName: String(values.get("firstName")),
        lastName: String(values.get("lastName")),
        email: submittedEmail,
        dateOfBirth: String(values.get("dateOfBirth")),
        password: String(values.get("password")),
      };
      if (therapist) {
        // Šaljemo samo polja profila; THERAPIST ulogu određuje poseban serverski endpoint.
        for (const name of [
          "title",
          "biography",
          "city",
          "phone",
          "address",
          "serviceName",
          "durationMinutes",
          "priceEur",
        ]) {
          registrationValues[name] = String(values.get(name) || "");
        }
      }
      const response = await requestAuth(
        therapist ? "register/therapist" : "register",
        registrationValues,
      );
      if (!response.challengeId)
        throw new Error("Nedostaje oznaka registracije.");
      setEmail(submittedEmail);
      setDelivery(response.delivery || "smtp");
      setChallengeId(response.challengeId);
      setResendSeconds(response.resendAfterSeconds || 60);
      savePendingRegistration(
        pendingRegistrationKey,
        response.challengeId,
        submittedEmail,
        response.delivery || "smtp",
        Date.now() + (response.resendAfterSeconds || 60) * 1000,
      );
      // Poslije slanja brišemo lozinku iz DOM-a; zahtjev i njen hash ostaju samo na serveru.
      registrationForm.current?.reset();
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      requestInProgress.current = false;
      setSubmitting(false);
    }
  }

  /** Potvrđuje četvorocifreni kod; korisnik se prijavljuje tek nakon kreiranja naloga. */
  async function handleVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInProgress.current) return;
    setPendingAction("verify");
    const values = new FormData(event.currentTarget);
    requestInProgress.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await requestAuth("verify", {
        challengeId,
        code: String(values.get("code")),
      });
      if (!response.user) throw new Error("Nedostaje odgovor o nalogu.");
      setUser(response.user);
      clearPendingRegistration(pendingRegistrationKey);
      void refreshDirectory();
      router.replace(accountHome(response.user));
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      requestInProgress.current = false;
      setSubmitting(false);
    }
  }

  /** Traži novi email nakon pauze; raniji kod server poništava. */
  async function handleResendCode() {
    if (requestInProgress.current || resendSeconds > 0) return;
    setPendingAction("resend");
    requestInProgress.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await requestAuth("resend", { challengeId });
      setResendSeconds(response.resendAfterSeconds || 60);
      savePendingRegistration(
        pendingRegistrationKey,
        challengeId,
        email,
        delivery,
        Date.now() + (response.resendAfterSeconds || 60) * 1000,
      );
      setNotice(
        translate(
          "Novi kod je poslat. Prethodni više ne važi.",
          "A new code was sent. The previous code is no longer valid.",
        ),
      );
      if (codeInput.current) {
        codeInput.current.value = "";
        codeInput.current.focus();
      }
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      requestInProgress.current = false;
      setSubmitting(false);
    }
  }

  /** Vraća prvi korak bez čuvanja lozinke ili zaobilaženja serverskog roka registracije. */
  function handleRestartRegistration() {
    clearPendingRegistration(pendingRegistrationKey);
    setChallengeId("");
    setError("");
    setNotice("");
  }

  let title = translate("Napravite svoj nalog.", "Create your account.");
  let description = translate(
    "Unesite podatke, pa potvrdite email adresu.",
    "Enter your details, then verify your email address.",
  );
  if (therapist) {
    title = translate("Registracija terapeuta.", "Therapist registration.");
    description = translate(
      "Kreirajte nalog, predstavite svoj rad i unesite početnu uslugu.",
      "Create your account, introduce your work and add your first service.",
    );
  }
  if (challengeId) {
    title = translate("Potvrdite email.", "Verify your email.");
    description = translate(
      `Unesite četvorocifreni kod poslat na ${email}. Kod važi najviše 10 minuta.`,
      `Enter the four-digit code sent to ${email}. It expires in up to 10 minutes.`,
    );
  }

  return (
    <AuthLayout title={title} description={description}>
      <ol
        className="auth-steps"
        aria-label={translate("Koraci registracije", "Registration steps")}
      >
        <li className={!challengeId ? "current" : "complete"}>
          1.{" "}
          {therapist
            ? translate("Nalog i profil", "Account and profile")
            : translate("Vaši podaci", "Your details")}
        </li>
        <li className={challengeId ? "current" : ""}>
          2. {translate("Potvrda emaila", "Email verification")}
        </li>
      </ol>
      {user ? (
        <Link href={accountHome(user)} className="button button-primary">
          {translate("Nastavi", "Continue")}
        </Link>
      ) : !challengeId ? (
        <form
          ref={registrationForm}
          onSubmit={handleRegistration}
          aria-busy={submitting}
        >
          <div className="form-row">
            <label className="field">
              <span>{translate("Ime", "First name")}</span>
              <input
                name="firstName"
                autoComplete="given-name"
                required
                maxLength={60}
              />
            </label>
            <label className="field">
              <span>{translate("Prezime", "Last name")}</span>
              <input
                name="lastName"
                autoComplete="family-name"
                required
                maxLength={60}
              />
            </label>
          </div>
          <label className="field">
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              defaultValue={email}
            />
          </label>
          <label className="field">
            <span>{translate("Datum rođenja", "Date of birth")}</span>
            <input
              name="dateOfBirth"
              type="date"
              autoComplete="bday"
              min="1900-01-01"
              required
            />
          </label>
          <label className="field">
            <span id="registration-password-label">
              {translate("Lozinka", "Password")}
            </span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              required
              aria-describedby="password-help"
              aria-labelledby="registration-password-label"
            />
            <small id="password-help">
              {translate(
                "Najmanje 15 znakova. Možete koristiti više riječi.",
                "At least 15 characters. You can use several words.",
              )}
            </small>
          </label>
          {therapist && <TherapistRegistrationFields />}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <ActionButton
            pending={submitting}
            className="button button-primary auth-submit"
            disabled={submitting}
          >
            {submitting
              ? translate("Slanje koda…", "Sending code…")
              : translate("Dalje", "Next")}
            <ArrowRight size={17} />
          </ActionButton>
        </form>
      ) : (
        <>
          {delivery === "local" && (
            <div className="info-note">
              <Mail size={18} />
              <span>
                {translate(
                  "Kod je u testnom sandučetu koje se otvara na ovom računaru.",
                  "The code is in the test inbox available on this computer.",
                )}{" "}
                <a
                  href="http://127.0.0.1:8025"
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                >
                  {translate("Otvori testno sanduče", "Open test inbox")}
                </a>
              </span>
            </div>
          )}
          <form onSubmit={handleVerification} aria-busy={submitting}>
            <label className="field">
              <span>{translate("Kod iz emaila", "Email code")}</span>
              <input
                ref={codeInput}
                className="auth-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{4}"
                minLength={4}
                maxLength={4}
                required
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            <ActionButton
              pending={submitting && pendingAction === "verify"}
              className="button button-primary auth-submit"
              disabled={submitting}
            >
              {submitting && pendingAction === "verify"
                ? translate("Provjera…", "Verifying…")
                : translate(
                    "Potvrdi i kreiraj nalog",
                    "Verify and create account",
                  )}
              <ShieldCheck size={17} />
            </ActionButton>
          </form>
          <ActionButton
            pending={submitting && pendingAction === "resend"}
            type="button"
            className="button button-quiet auth-submit"
            disabled={submitting || resendSeconds > 0}
            onClick={handleResendCode}
          >
            {submitting && pendingAction === "resend"
              ? translate("Slanje koda…", "Sending code…")
              : resendSeconds > 0
                ? translate(
                    `Novi kod za ${resendSeconds} s`,
                    `New code in ${resendSeconds} s`,
                  )
                : translate("Pošalji novi kod", "Resend code")}
          </ActionButton>
          <button
            type="button"
            className="text-link"
            disabled={submitting}
            onClick={handleRestartRegistration}
          >
            {translate(
              "Promijeni email ili započni ponovo",
              "Change email or start again",
            )}
          </button>
        </>
      )}
      <p className="auth-switch">
        {translate("Već imate nalog?", "Already have an account?")}{" "}
        <Link href="/login">{translate("Prijavite se", "Sign in")}</Link>
      </p>
      <p className="auth-switch">
        <Link href={therapist ? "/register" : "/register/therapist"}>
          {therapist
            ? translate("Registracija za klijente", "Registration for clients")
            : translate(
                "Registracija za terapeute",
                "Registration for therapists",
              )}
        </Link>
      </p>
    </AuthLayout>
  );
}
