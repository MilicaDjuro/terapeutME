// Zajednički okvir stranica: navigacija, jezik, mobilni meni i footer. Nema pravila rezervacija.
"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  Menu,
  X,
  HeartHandshake,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { useDemo } from "@/lib/demo-context";
import { useAuth } from "@/lib/auth-context";
import { AccountMenu } from "./account-menu";
/** Prikazuje znak i naziv Terapeut.me kao link ka početnoj stranici. */
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Terapeut.me — početna">
      {/* Lokalni logo se prikazuje bez zavisnosti od dostupnosti referentnog sajta. */}
      <Image
        className="brand-logo"
        src="/brand/logo.png"
        alt="terapeut.me"
        width={180}
        height={36}
        loading="eager"
      />
      <Image
        className="brand-mobile-symbol"
        src="/brand/symbol.png"
        alt=""
        width={36}
        height={33}
        loading="eager"
      />
    </Link>
  );
}
/** Prikazuje zajedničku navigaciju, izbor jezika, mobilni meni i footer oko stranice. */
export function Shell({ children }: { children: React.ReactNode }) {
  const { translate, locale, setLocale, notice } = useDemo();
  const { user } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = [
    {
      href: "/psychotherapy",
      label: translate("Pronađi stručnjaka", "Find a professional"),
    },
    {
      href: "/#kako-funkcionise",
      label: translate("Kako funkcioniše", "How it works"),
    },
    { href: "/faq", label: translate("Česta pitanja", "FAQ") },
  ];
  if (user?.role === "THERAPIST")
    links.unshift({
      href: "/dashboard",
      label: translate("Moj pregled", "My dashboard"),
    });
  return (
    <>
      <div className="demo-strip">
        {translate(
          "Radno vrijeme i rezervacije povezani sa vašim nalogom",
          "Working hours and bookings connected to your account",
        )}
        <Link href="/demo/dashboard">
          {translate("Demo pregled", "Demo dashboard")}
          <ArrowUpRight size={12} />
        </Link>
      </div>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav
            className="desktop-nav"
            aria-label={translate("Glavna navigacija", "Main navigation")}
          >
            {links.map((link) => (
              <Link
                className={path === link.href ? "active" : ""}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <button
              className="language-button"
              onClick={() => setLocale(locale === "mne" ? "en" : "mne")}
              aria-label={translate(
                "Switch to English",
                "Prebaci na crnogorski",
              )}
            >
              {locale === "mne" ? "EN" : "MNE"}
            </button>
            {user ? (
              <AccountMenu />
            ) : (
              <Link
                href="/login"
                className="button button-outline button-sm dashboard-link"
              >
                {translate("Prijavi se", "Sign in")}
                <ArrowUpRight size={14} />
              </Link>
            )}
            <button
              className="icon-button mobile-menu"
              aria-label={translate("Otvori navigaciju", "Open navigation")}
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {open && (
          <nav
            id="mobile-nav"
            className="mobile-nav"
            aria-label={translate("Mobilna navigacija", "Mobile navigation")}
          >
            {[
              ...links,
              {
                href: user ? "/account" : "/login",
                label: user
                  ? translate("Moj nalog", "My account")
                  : translate("Prijavi se", "Sign in"),
              },
              ...(!user
                ? [
                    {
                      href: "/register",
                      label: translate("Registruj se", "Register"),
                    },
                  ]
                : []),
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
              >
                {link.label}
                <ChevronRight size={16} />
              </Link>
            ))}
          </nav>
        )}
      </header>
      {notice && (
        <div className="storage-notice" role="status">
          {notice === "STORAGE_RESET"
            ? translate(
                "Probni podaci su vraćeni jer sačuvani podaci nijesu bili čitljivi.",
                "Sample data was restored because saved data could not be read.",
              )
            : translate(
                "Promjene su dostupne samo dok je ova stranica otvorena; čuvanje u browseru nije dostupno.",
                "Changes are available only while this page is open; browser storage is unavailable.",
              )}
        </div>
      )}
      <main id="main-content">{children}</main>
      <footer className="site-footer">
        <div className="container footer-top">
          <div>
            <Brand />
            <p>
              {translate(
                "Prostor za prvi korak. Podrška za ono što slijedi.",
                "Space for a first step. Support for what follows.",
              )}
            </p>
          </div>
          <div className="footer-links">
            <Link href="/faq">{translate("Česta pitanja", "FAQ")}</Link>
            <Link href="/privacy">{translate("Privatnost", "Privacy")}</Link>
            <Link href="/terms">{translate("Uslovi korišćenja", "Terms")}</Link>
            <a href="mailto:info@terapeut.me">
              info@terapeut.me
              <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© {new Date().getFullYear()} Terapeut.me</span>
          <span>
            <HeartHandshake size={14} />
            {translate(
              "Sa pažnjom, u Crnoj Gori.",
              "With care, in Montenegro.",
            )}
          </span>
        </div>
      </footer>
    </>
  );
}
