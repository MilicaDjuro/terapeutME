"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { accountHome, authErrorMessage, requestAuth } from "@/lib/auth-client";
import { ActionButton, Loading } from "@/components/ui";
import { AuthLayout } from "./auth-pages";

/** Traži email link bez otkrivanja da li unesena adresa pripada registrovanom nalogu. */
export function ForgotPasswordPage() {
  const { translate } = useDemo();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [localDelivery, setLocalDelivery] = useState(false);
  const [error, setError] = useState("");
  const pendingRequest = useRef<AbortController | null>(null);

  // Zatvaranje stranice prekida čekanje odgovora, bez čuvanja emaila ili tokena u skladištu browsera.
  useEffect(() => {
    /** Sprečava da odgovor promijeni stanje nakon odlaska sa stranice. */
    function stopRequest() {
      pendingRequest.current?.abort();
    }
    return stopRequest;
  }, []);

  /** Šalje email jednom; poruka je ista za postojeće i nepostojeće naloge. */
  async function handleSendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRequest.current) return;
    const values = new FormData(event.currentTarget);
    const controller = new AbortController();
    pendingRequest.current = controller;
    setSubmitting(true);
    setError("");
    try {
      const response = await requestAuth(
        "forgot-password",
        { email: String(values.get("email") || "") },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setLocalDelivery(response.delivery === "local");
      setSent(true);
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pendingRequest.current = null;
        setSubmitting(false);
      }
    }
  }

  return (
    <AuthLayout
      title={translate("Zaboravili ste lozinku?", "Forgot your password?")}
      description={translate(
        "Unesite email svog naloga da zatražite link za novu lozinku.",
        "Enter your account email to request a password reset link.",
      )}
    >
      {sent ? (
        <>
          <p role="status" className="form-success">
            {translate(
              "Ako postoji aktivan nalog sa ovom email adresom, uputstvo za obnovu lozinke stići će na email.",
              "If an active account exists for this address, password reset instructions will arrive by email.",
            )}
          </p>
          <p>
            {translate(
              "Link važi 15 minuta. Provjerite i spam folder.",
              "The link is valid for 15 minutes. Check your spam folder too.",
            )}
          </p>
          {localDelivery && (
            <p className="info-note">
              {translate(
                "Lokalni emailovi stižu u testno sanduče.",
                "Local emails arrive in the test inbox.",
              )}{" "}
              <a
                href="http://127.0.0.1:8025"
                target="_blank"
                rel="noreferrer"
                className="text-link"
              >
                {translate("Otvori testno sanduče", "Open test inbox")}
              </a>
            </p>
          )}
        </>
      ) : (
        <form onSubmit={handleSendLink} aria-busy={submitting}>
          <fieldset
            className="therapist-registration-fields"
            disabled={submitting}
          >
            <legend>{translate("Obnova lozinke", "Password recovery")}</legend>
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
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <ActionButton
              pending={submitting}
              type="submit"
              className="button button-primary auth-submit"
            >
              {submitting
                ? translate("Slanje…", "Sending…")
                : translate("Pošalji link", "Send reset link")}
            </ActionButton>
          </fieldset>
        </form>
      )}
      <p className="auth-switch">
        <Link href="/login">
          {translate("Vrati se na prijavu", "Back to sign in")}
        </Link>
      </p>
    </AuthLayout>
  );
}

/** Čita JWT iz fragmenta email linka i šalje ga samo API-ju za jednokratnu obnovu. */
export function ResetPasswordPage() {
  const { translate } = useDemo();
  const { setUser } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const pendingRequest = useRef<AbortController | null>(null);

  // Fragment nije dostupan Next.js serveru. Čitamo ga tek u browseru; refresh zadržava link.
  useEffect(() => {
    /** Pri otvaranju drugog email linka u istom tabu čita novi fragment bez obaveznog refresh-a. */
    function readResetLink() {
      setToken(
        new URLSearchParams(window.location.hash.slice(1)).get("token") || "",
      );
      setError("");
    }
    readResetLink();
    window.addEventListener("hashchange", readResetLink);
    /** Prekida čekanje pri zatvaranju; već sačuvana serverska transakcija ostaje važeća. */
    function stopRequest() {
      pendingRequest.current?.abort();
      window.removeEventListener("hashchange", readResetLink);
    }
    return stopRequest;
  }, []);

  /** Provjerava potvrdu, čuva novu lozinku i otvara početni ekran po serverskoj ulozi. */
  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRequest.current || !token) return;
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password") || "");
    const confirmation = String(values.get("confirmPassword") || "");
    setError("");
    if (password !== confirmation) {
      setError(
        translate("Lozinke se ne podudaraju.", "The passwords do not match."),
      );
      return;
    }
    const controller = new AbortController();
    pendingRequest.current = controller;
    setSubmitting(true);
    try {
      const response = await requestAuth(
        "reset-password",
        { token, password, confirmPassword: confirmation },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!response.user) throw new Error("Nedostaje odgovor o nalogu.");
      // Poslije uspjeha uklanjamo jednokratni link iz trenutne adrese i prihvatamo novi HttpOnly kolačić.
      window.history.replaceState(null, "", window.location.pathname);
      setUser(response.user);
      router.replace(accountHome(response.user));
    } catch (failure) {
      if (!controller.signal.aborted) setError(authErrorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        pendingRequest.current = null;
        setSubmitting(false);
      }
    }
  }

  return (
    <AuthLayout
      title={translate("Postavite novu lozinku.", "Set a new password.")}
      description={translate(
        "Unesite novu lozinku i ponovite je radi potvrde. Nakon čuvanja bićete prijavljeni.",
        "Enter and confirm your new password. You will be signed in after saving.",
      )}
    >
      {token === null ? (
        <Loading />
      ) : !token ? (
        <p role="alert" className="form-error">
          {translate(
            "Nedostaje link za obnovu lozinke. Otvorite link iz emaila ili zatražite novi.",
            "The reset link is missing. Open the email link or request a new one.",
          )}
        </p>
      ) : (
        <form onSubmit={handleResetPassword} aria-busy={submitting}>
          <fieldset
            className="therapist-registration-fields"
            disabled={submitting}
          >
            <legend>{translate("Nova lozinka", "New password")}</legend>
            <label className="field">
              <span id="new-password-label">
                {translate("Nova lozinka", "New password")}
              </span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={15}
                maxLength={128}
                aria-labelledby="new-password-label"
                aria-describedby="new-password-help"
              />
            </label>
            <p id="new-password-help" className="muted small">
              {translate(
                "Najmanje 15 znakova. Možete koristiti više riječi.",
                "At least 15 characters. You can use several words.",
              )}
            </p>
            <label className="field">
              <span>
                {translate("Potvrdite novu lozinku", "Confirm new password")}
              </span>
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={15}
                maxLength={128}
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <ActionButton
              pending={submitting}
              type="submit"
              className="button button-primary auth-submit"
            >
              {submitting
                ? translate("Čuvanje…", "Saving…")
                : translate(
                    "Sačuvaj lozinku i prijavi se",
                    "Save password and sign in",
                  )}
            </ActionButton>
          </fieldset>
        </form>
      )}
      <p className="auth-switch">
        <Link href="/forgot-password">
          {translate("Zatraži novi link", "Request a new link")}
        </Link>
      </p>
      <p className="auth-switch">
        <Link href="/login">
          {translate("Vrati se na prijavu", "Back to sign in")}
        </Link>
      </p>
    </AuthLayout>
  );
}
