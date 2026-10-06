"use client";
/** Prikazuje grešku pri učitavanju i dugme kojim Next.js ponovo pokušava prikaz. */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="container page-space empty-state" role="alert">
      <h1>Stranica nije mogla da se učita.</h1>
      <p>Please try again.</p>
      <button className="button button-primary" onClick={reset}>
        Pokušaj ponovo / Try again
      </button>
    </div>
  );
}
