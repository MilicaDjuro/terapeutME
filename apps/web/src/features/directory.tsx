// Katalog. URL čuva filtere, a matchesFilters provjerava jedan profil po jednom pravilu.
"use client";
import type { Therapist } from "@terapeut/domain";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X, ArrowRight } from "lucide-react";
import { useDemo } from "@/lib/demo-context";
import { TherapistCard, Loading } from "@/components/ui";
import { useDirectory } from "@/lib/directory-context";
import { DirectoryError } from "@/components/directory-error";
/** Čita URL filtere i prikazuje samo aktivne profile koji zadovoljavaju pretragu. */
export function Directory() {
  const { translate, locale } = useDemo();
  const { therapists, loading, error } = useDirectory();
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") || "";
  const city = params.get("city") || "";
  const type = params.get("type") || "";
  const language = params.get("language") || "";
  const max = params.get("priceMax") || "";
  /** Mijenja jedan URL filter bez skoka na vrh stranice i čuva ostale filtere. */
  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/psychotherapy${next.size ? `?${next}` : ""}`, {
      scroll: false,
    });
  }
  /** Provjerava filtere jednog terapeuta, redom, i vraća da li ga treba prikazati. */
  function matchesFilters(therapist: Therapist): boolean {
    if (!therapist.active) {
      return false;
    }
    if (city && therapist.city !== city) {
      return false;
    }
    if (type && therapist.profession !== type) {
      return false;
    }
    if (language && !therapist.languages.includes(language)) {
      return false;
    }
    if (max) {
      const affordableService = therapist.services.some(
        (service) =>
          service.active &&
          service.price !== null &&
          service.price <= Number(max),
      );
      if (!affordableService) {
        return false;
      }
    }
    if (q) {
      const searchableText = [
        therapist.name,
        therapist.title,
        therapist.titleEn,
        therapist.bio,
        ...therapist.approaches,
        ...therapist.approachesEn,
      ]
        .join(" ")
        .toLocaleLowerCase();
      if (!searchableText.includes(q.toLocaleLowerCase())) {
        return false;
      }
    }
    return true;
  }
  const results = therapists.filter(matchesFilters);
  results?.sort((first, second) =>
    first.name.localeCompare(second.name, locale === "mne" ? "sr-Latn" : "en"),
  );
  const cities: string[] = [];
  for (const therapist of therapists) {
    if (!cities.includes(therapist.city)) {
      cities.push(therapist.city);
    }
  }
  cities.sort();
  if (error) return <DirectoryError />;
  return (
    <div className="container page-space">
      <div className="page-intro">
        <span className="eyebrow">
          {translate("VAŠ PROSTOR ZA PODRŠKU", "YOUR SPACE FOR SUPPORT")}
        </span>
        <h1>
          {translate(
            "Pronađite osobu koja vam odgovara.",
            "Find someone who feels right for you.",
          )}
        </h1>
        <p>
          {translate(
            "Svaki prvi korak je drugačiji. Istražite stručnjake i izaberite podršku za sebe.",
            "Every first step is different. Explore professionals and choose the support that suits you.",
          )}
        </p>
      </div>
      <div className="directory-layout">
        <aside className="filter-panel">
          <div className="filter-title">
            <SlidersHorizontal size={18} />
            <h2>{translate("Prilagodite pretragu", "Refine your search")}</h2>
          </div>
          <label className="field">
            <span>{translate("Pretraga", "Search")}</span>
            <div className="input-icon">
              <Search size={16} />
              <input
                value={q}
                onChange={(event) => updateFilter("q", event.target.value)}
                placeholder={translate("Ime ili pristup…", "Name or approach…")}
              />
            </div>
          </label>
          <label className="field">
            <span>{translate("Struka", "Profession")}</span>
            <select
              value={type}
              onChange={(event) => updateFilter("type", event.target.value)}
            >
              <option value="">
                {translate("Sve struke", "All professions")}
              </option>
              <option value="psychologist">
                {translate("Psihologija", "Psychology")}
              </option>
              <option value="psychotherapist">
                {translate("Psihoterapija", "Psychotherapy")}
              </option>
              <option value="psychiatrist">
                {translate("Psihijatrija", "Psychiatry")}
              </option>
            </select>
          </label>
          <label className="field">
            <span>{translate("Opština", "Municipality")}</span>
            <select
              value={city}
              onChange={(event) => updateFilter("city", event.target.value)}
            >
              <option value="">
                {translate("Sve opštine", "All municipalities")}
              </option>
              {cities.map((cityName) => (
                <option key={cityName}>{cityName}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{translate("Jezik razgovora", "Session language")}</span>
            <select
              value={language}
              onChange={(event) => updateFilter("language", event.target.value)}
            >
              <option value="">
                {translate("Svi jezici", "All languages")}
              </option>
              <option>Crnogorski</option>
              <option>English</option>
            </select>
          </label>
          <label className="field">
            <span>{translate("Najviša cijena (€)", "Maximum price (€)")}</span>
            <input
              type="number"
              min="0"
              value={max}
              onChange={(event) => updateFilter("priceMax", event.target.value)}
              placeholder={translate("Bez ograničenja", "No limit")}
            />
          </label>
          {params.size > 0 && (
            <button
              className="clear-filter"
              onClick={() =>
                router.replace("/psychotherapy", { scroll: false })
              }
            >
              <X size={14} />
              {translate("Očisti filtere", "Clear filters")}
            </button>
          )}
          <div className="filter-note">
            {translate(
              "Svi susreti su uživo. Cijenu i detalje možete dogovoriti direktno sa terapeutom.",
              "All sessions take place in person. You can discuss prices and details directly with your therapist.",
            )}
          </div>
        </aside>
        <section className="results-panel">
          <div className="results-heading">
            <p>
              <strong>{results?.length ?? "—"}</strong>{" "}
              {translate("stručnjaka u pretrazi", "professionals found")}
            </p>
            <span>{translate("Po abecednom redu", "Alphabetical order")}</span>
          </div>
          {loading ? (
            <Loading />
          ) : results?.length ? (
            <div className="therapist-grid directory-cards">
              {results.map((candidateTherapist) => (
                <TherapistCard
                  therapist={candidateTherapist}
                  key={candidateTherapist.id}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Search size={32} />
              <h2>
                {translate(
                  "Nema rezultata za ove filtere.",
                  "No matches for these filters.",
                )}
              </h2>
              <p>
                {translate(
                  "Pokušajte sa drugom opštinom ili uklonite neki filter.",
                  "Try another municipality or remove a filter.",
                )}
              </p>
              <button
                className="button button-primary"
                onClick={() => router.replace("/psychotherapy")}
              >
                {translate("Prikaži sve", "Show all")}
                <ArrowRight size={16} />
              </button>
            </div>
          )}
          <p className="sample-note">
            {translate(
              "Profili se učitavaju iz baze. U lokalnoj verziji postoje i probni stručnjaci.",
              "Profiles are loaded from the database. The local version also includes sample professionals.",
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
