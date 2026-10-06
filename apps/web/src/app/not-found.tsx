import Link from "next/link";
/** Prikazuje stranicu za nepostojeću adresu i link za povratak na početnu. */
export default function NotFound() {
  return (
    <div className="container page-space empty-state">
      <span className="eyebrow">404</span>
      <h1>Ova stranica nije dostupna.</h1>
      <p>This page could not be found.</p>
      <Link className="button button-primary" href="/">
        Nazad na početnu / Go home
      </Link>
    </div>
  );
}
