"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  BarChart3,
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { authErrorMessage, requestAuth } from "@/lib/auth-client";
import { ActionButton } from "./ui";

/** Otvara linkove naloga i odjavu; sesija se briše iz prikaza tek poslije serverske potvrde. */
export function AccountMenu() {
  const { user, setUser } = useAuth();
  const { translate } = useDemo();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const loggingOut = useRef(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    /** Klik van menija zatvara prikaz bez izmjene naloga. */
    function handleOutside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    /** Escape zatvara padajuću listu i vraća fokus na dugme koje ju je otvorilo. */
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    /** Uklanja slušače pri zatvaranju menija ili odjavi. */
    function stopListening() {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    }
    return stopListening;
  }, [open]);

  /** Otvara ili zatvara meni; greška odjave ostaje dostupna za ponovni pokušaj. */
  function handleToggle() {
    setOpen(!open);
  }
  /** Zatvara listu i kada se bira sekcija na već otvorenoj stranici naloga ili pregleda. */
  function handleClose() {
    setOpen(false);
  }
  /** Server opoziva JWT sesiju prije preusmjeravanja; ref sprečava dvostruku odjavu. */
  async function handleLogout() {
    if (loggingOut.current) return;
    loggingOut.current = true;
    setSubmitting(true);
    setError("");
    try {
      await requestAuth("logout", {});
      setUser(null);
      router.replace("/login");
    } catch (failure) {
      setError(authErrorMessage(failure));
      setOpen(true);
    } finally {
      loggingOut.current = false;
      setSubmitting(false);
    }
  }
  if (!user) return null;
  return (
    <div className="account-menu" ref={container}>
      <button
        ref={trigger}
        type="button"
        className="button button-outline button-sm account-menu-trigger"
        aria-expanded={open}
        aria-controls="account-dropdown"
        onClick={handleToggle}
      >
        <UserRound size={16} aria-hidden="true" />
        {translate("Moj nalog", "My account")}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="account-dropdown" id="account-dropdown">
          <div className="account-menu-identity">
            <strong>
              {user.firstName} {user.lastName}
            </strong>
            <span>
              {translate(
                user.role === "THERAPIST" ? "Psihoterapeut" : "Vaš nalog",
                user.role === "THERAPIST" ? "Psychotherapist" : "Your account",
              )}
            </span>
          </div>
          {user.role === "CLIENT" && (
            <Link href="/account#my-bookings" onClick={handleClose}>
              <CalendarDays size={17} aria-hidden="true" />
              {translate("Moji termini", "My sessions")}
            </Link>
          )}
          {(user.role === "CLIENT" || user.role === "THERAPIST") && (
            <Link
              href={
                user.role === "THERAPIST"
                  ? "/dashboard#my-materials"
                  : "/account#my-materials"
              }
              onClick={handleClose}
            >
              <BookOpen size={17} aria-hidden="true" />
              {translate(
                "Domaći zadaci i materijali",
                "Homework and materials",
              )}
            </Link>
          )}
          <Link href="/account#my-profile" onClick={handleClose}>
            <UserRound size={17} aria-hidden="true" />
            {translate("Uredi moj profil", "Edit my profile")}
          </Link>
          {user.role === "THERAPIST" && (
            <Link href="/dashboard/analytics" onClick={handleClose}>
              <BarChart3 size={17} aria-hidden="true" />
              {translate("Analitika profila", "Profile analytics")}
            </Link>
          )}
          {user.role === "THERAPIST" && (
            <Link href="/dashboard" onClick={handleClose}>
              <LayoutDashboard size={17} aria-hidden="true" />
              {translate("Moj pregled", "My dashboard")}
            </Link>
          )}
          <ActionButton
            type="button"
            className="account-menu-logout"
            pending={submitting}
            pendingText={translate("Odjavljivanje…", "Signing out…")}
            onClick={handleLogout}
          >
            <LogOut size={17} aria-hidden="true" />
            {translate("Odjavi se", "Sign out")}
          </ActionButton>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
