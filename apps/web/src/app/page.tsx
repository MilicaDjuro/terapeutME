// Početna stranica. Tekst i raspored su ovdje; pretraga samo otvara katalog sa URL parametrima.
"use client";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  HeartHandshake,
  Search,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDemo } from "@/lib/demo-context";
import { TherapistCard } from "@/components/ui";
import { useDirectory } from "@/lib/directory-context";
/** Prikazuje početnu stranicu; pretraga vodi u katalog i čuva filtere u adresi. */
export default function Home() {
  const { translate } = useDemo();
  const { therapists } = useDirectory();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  /** Čita izabranu pretragu i opštinu i otvara katalog sa tim URL filterima. */
  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const searchParams = new URLSearchParams();
    if (query) {
      searchParams.set("q", query);
    }
    if (city) {
      searchParams.set("city", city);
    }
    router.push(`/psychotherapy?${searchParams}`);
  }
  return (
    <>
      <section className="home-hero">
        <div className="container hero-grid">
          <div className="hero-content">
            <span className="hero-brand-symbol" aria-hidden="true">
              <Image src="/brand/symbol.png" alt="" width={44} height={40} />
            </span>
            <span className="eyebrow">
              <span className="eyebrow-dot" />
              {translate(
                "MENTALNO ZDRAVLJE, BLIŽE VAMA",
                "MENTAL HEALTH, CLOSER TO YOU",
              )}
            </span>
            <h1>
              {translate("Podrška počinje", "Support begins")}
              <br />
              <span>{translate("razgovorom.", "with a conversation.")}</span>
            </h1>
            <p className="hero-description">
              {translate(
                "Ne morate imati sve odgovore da biste napravili prvi korak. Pronađite stručnjaka uz kojeg ćete se osjećati saslušano.",
                "You don’t need all the answers to take a first step. Find a professional who makes you feel heard.",
              )}
            </p>
            <Link
              href="/psychotherapy"
              className="button button-primary button-lg"
            >
              {translate("Pronađi svog stručnjaka", "Find your professional")}
              <ArrowRight size={18} />
            </Link>
            <div className="hero-reassurance">
              <span>
                <Check size={14} />
                {translate("Vašim tempom", "At your pace")}
              </span>
              <span>
                <Check size={14} />
                {translate("Uživo ili online", "In person or online")}
              </span>
              <span>
                <Check size={14} />
                {translate("Širom Crne Gore", "Across Montenegro")}
              </span>
            </div>
          </div>
          {/* Slika je dekoracija; pretraga i podaci stručnjaka ostaju povezani sa postojećim katalogom. */}
          <div className="hero-landscape" aria-hidden="true">
            <Image
              src="/brand/nature.webp"
              alt=""
              width={1024}
              height={1024}
              sizes="(max-width: 800px) 100vw, 900px"
              preload
            />
          </div>
        </div>
      </section>
      <div className="container">
        <form className="quick-search" onSubmit={handleSearch}>
          <div className="search-intro">
            <Search size={23} />
            <strong>{translate("Vaš sljedeći korak", "Your next step")}</strong>
          </div>
          <label className="search-field">
            <span>
              {translate("Šta tražite?", "What are you looking for?")}
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={translate(
                "Ime, pristup ili stručnjak",
                "Name, approach or professional",
              )}
            />
          </label>
          <label className="search-field search-city">
            <span>{translate("Gdje?", "Where?")}</span>
            <select
              value={city}
              onChange={(event) => setCity(event.target.value)}
            >
              <option value="">
                {translate("Sve opštine", "All municipalities")}
              </option>
              {["Podgorica", "Nikšić", "Bar", "Budva"].map((cityName) => (
                <option key={cityName}>{cityName}</option>
              ))}
            </select>
          </label>
          <button className="button button-primary" type="submit">
            {translate("Pretraži", "Search")}
            <ArrowRight size={17} />
          </button>
        </form>
      </div>
      <section className="section container" id="kako-funkcionise">
        <div className="section-header">
          <div>
            <span className="eyebrow">
              {translate(
                "JEDNOSTAVNO, KORAK PO KORAK",
                "ONE SIMPLE STEP AT A TIME",
              )}
            </span>
            <h2>
              {translate(
                "Od prvog klika do razgovora.",
                "From a first click to a conversation.",
              )}
            </h2>
          </div>
          <p>
            {translate(
              "Vi birate osobu i vrijeme. Mi olakšavamo povezivanje.",
              "You choose the person and the time. We make the connection easier.",
            )}
          </p>
        </div>
        <div className="steps-grid">
          {[
            {
              icon: Search,
              title: translate("Pronađite stručnjaka", "Find a professional"),
              text: translate(
                "Istražite profile, pristupe i usluge. Izaberite osobu koja vam odgovara.",
                "Explore profiles, approaches and services. Choose someone who feels right for you.",
              ),
            },
            {
              icon: CalendarDays,
              title: translate("Izaberite svoj termin", "Choose your time"),
              text: translate(
                "Odaberite uslugu, pa slobodan termin u kalendaru. Pošaljite zahtjev.",
                "Choose a service and an available time in the calendar. Send your request.",
              ),
            },
            {
              icon: HeartHandshake,
              title: translate("Dogovorite susret", "Arrange your session"),
              text: translate(
                "Terapeut potvrđuje ili predlaže drugo vrijeme. Detalje dogovarate direktno.",
                "Your therapist confirms or suggests another time. Arrange the details directly.",
              ),
            },
          ].map((step, i) => (
            <div className="step-card" key={i}>
              <div className="step-top">
                <span className="step-icon">
                  <step.icon size={22} />
                </span>
                <span className="step-number">0{i + 1}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="section featured-section">
        <div className="container">
          <div className="section-header">
            <div>
              <span className="eyebrow">
                {translate("LJUDI KOJI SLUŠAJU", "PEOPLE WHO LISTEN")}
              </span>
              <h2>
                {translate(
                  "Upoznajte naše stručnjake.",
                  "Meet our professionals.",
                )}
              </h2>
            </div>
            <Link href="/psychotherapy" className="text-link">
              {translate("Pogledaj sve stručnjake", "View all professionals")}
              <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="therapist-grid home-cards">
            {therapists
              .filter((candidateTherapist) => candidateTherapist.active)
              .slice(0, 3)
              .map((candidateTherapist) => (
                <TherapistCard
                  key={candidateTherapist.id}
                  therapist={candidateTherapist}
                />
              ))}
          </div>
          <p className="sample-note">
            {translate(
              "Profili se učitavaju iz baze. Lokalni katalog sadrži i izmišljene probne stručnjake.",
              "Profiles are loaded from the database. The local directory also includes fictional sample professionals.",
            )}
          </p>
        </div>
      </section>
      <section className="section container">
        <div className="care-banner">
          <div className="care-icon">
            <HeartHandshake size={36} />
          </div>
          <div>
            <span className="eyebrow">
              {translate("NE MORATE SVE SAMI", "YOU DON’T HAVE TO DO IT ALONE")}
            </span>
            <h2>
              {translate(
                "U redu je potražiti podršku.",
                "It’s okay to ask for support.",
              )}
            </h2>
            <p>
              {translate(
                "Ako još nijeste sigurni kako da počnete, pogledajte odgovore na česta pitanja.",
                "If you’re unsure where to start, explore our frequently asked questions.",
              )}
            </p>
          </div>
          <Link href="/faq" className="button button-outline">
            {translate("Imam pitanje", "I have a question")}
            <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </>
  );
}
