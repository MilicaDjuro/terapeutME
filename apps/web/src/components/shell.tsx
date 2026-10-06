// Zajednički okvir stranica: navigacija, jezik, mobilni meni i footer. Nema pravila rezervacija.
"use client";
import Link from "next/link";
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
/** Prikazuje znak i naziv Terapeut.me kao link ka početnoj stranici. */
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Terapeut.me — početna">
      <span className="brand-symbol">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M16 26V15M16 20C6 20 4 13 6 6c7 0 11 5 10 14ZM16 16c0-7 5-11 11-10 1 7-3 12-11 10Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      terapeut<span className="brand-me">.me</span>
    </Link>
  );
}
/** Prikazuje zajedničku navigaciju, izbor jezika, mobilni meni i footer oko stranice. */
export function Shell({ children }: { children: React.ReactNode }) {
  const { translate, locale, setLocale, notice } = useDemo();
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
  return (
    <>
      <div className="demo-strip">
        {translate(
          "Početna verzija · Probni profili i podaci · Bez slanja emaila",
          "Initial version · Sample profiles and data · No emails sent",
        )}
        <Link href="/dashboard">
          {translate("Isprobaj pregled", "Explore the dashboard")}
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
            <Link
              href="/dashboard"
              className="button button-outline button-sm dashboard-link"
            >
              {translate("Moj pregled", "My dashboard")}
              <ArrowUpRight size={14} />
            </Link>
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
                href: "/dashboard",
                label: translate("Moj pregled", "My dashboard"),
              },
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
