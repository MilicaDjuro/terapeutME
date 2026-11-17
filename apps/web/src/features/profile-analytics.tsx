"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Eye,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useDemo } from "@/lib/demo-context";
import { accountHome, authErrorMessage } from "@/lib/auth-client";
import {
  requestAnalytics,
  type ProfileAnalytics,
} from "@/lib/analytics-client";
import { ActionButton, Loading, PendingStatus } from "@/components/ui";
import { AnalyticsVisitors } from "./analytics-visitors";

/** Čeka provjeru naloga; tuđi izvještaj nikada se ne zadržava nakon promjene korisnika. */
export function ProfileAnalyticsPage() {
  const { user, loading, error, refreshAccount } = useAuth();
  const { translate } = useDemo();
  const router = useRouter();
  useEffect(() => {
    if (loading || error) return;
    if (!user) router.replace("/login");
    else if (user.role !== "THERAPIST") router.replace(accountHome(user));
  }, [user, loading, error, router]);
  if (error)
    return (
      <div className="container page-space">
        <p role="alert">{error}</p>
        <button className="button button-primary" onClick={refreshAccount}>
          {translate("Pokušaj ponovo", "Try again")}
        </button>
      </div>
    );
  if (loading || user?.role !== "THERAPIST") return <Loading />;
  return <AnalyticsReport key={user.id} />;
}

/** Odvaja sadašnje stanje svih termina od broja radnji u izabranom periodu analitike. */
function AnalyticsCurrentBookings({
  counts,
}: {
  counts: ProfileAnalytics["currentBookings"];
}) {
  const { translate } = useDemo();
  const cards = [
    {
      key: "total",
      label: translate("Svi zahtjevi i termini", "All requests and sessions"),
      value: counts.total,
      note: translate(
        "Uključuje stalne termine i dodjele sa liste čekanja.",
        "Includes recurring sessions and waitlist allocations.",
      ),
    },
    {
      key: "waiting",
      label: translate("Na čekanju sada", "Waiting now"),
      value: counts.waiting,
      note: translate(
        `${counts.awaitingTherapist} čeka vas · ${counts.awaitingClient} čeka klijenta`,
        `${counts.awaitingTherapist} await you · ${counts.awaitingClient} await the client`,
      ),
    },
    {
      key: "confirmed",
      label: translate(
        "Trenutno potvrđeni termini",
        "Currently confirmed sessions",
      ),
      value: counts.confirmed,
      note: translate(
        "Termini koji sada imaju status potvrđeno.",
        "Sessions with a confirmed status now.",
      ),
    },
    {
      key: "history",
      label: translate(
        "Istorija zahtjeva i termina",
        "Request and session history",
      ),
      value: counts.history,
      note: translate(
        "Otkazani, odbijeni, istekli i završeni termini, uključujući nedolaske.",
        "Cancelled, declined, expired and completed sessions, including no-shows.",
      ),
    },
  ];
  return (
    <section
      className="analytics-current"
      aria-labelledby="current-bookings-title"
    >
      <h2 id="current-bookings-title">
        {translate(
          "Trenutno stanje zahtjeva i termina",
          "Current requests and sessions",
        )}
      </h2>
      <p className="analytics-note">
        {translate(
          "Ovo je stanje sada, za sve vaše termine. Ovi brojevi ne zavise od izabranog perioda analitike.",
          "This is the current status of all your sessions. These counts are independent of the selected analytics period.",
        )}
      </p>
      <div className="analytics-current-grid">
        {cards.map((card) => (
          <article className="analytics-metric" key={card.key}>
            <h3>{card.label}</h3>
            <strong data-testid={`current-${card.key}`}>{card.value}</strong>
            <p>{card.note}</p>
          </article>
        ))}
      </div>
      <Link className="back-link" href="/dashboard">
        {translate("Otvori zahtjeve i termine", "Open requests and sessions")}
      </Link>
    </section>
  );
}

/** Mijenja period, učitava agregate iz baze i objašnjava šta brojevi predstavljaju. */
function AnalyticsReport() {
  const { translate, locale } = useDemo();
  const [days, setDays] = useState(30);
  const [visitorPage, setVisitorPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [data, setData] = useState<ProfileAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Novi period prekida stari HTTP zahtjev; prikaz čeka isključivo najnoviji odgovor.
  useEffect(() => {
    const controller = new AbortController();
    /** Čita izvještaj; greška ostaje vidljiva uz mogućnost novog pokušaja. */
    async function loadAnalytics() {
      setLoading(true);
      setError("");
      setData(null);
      try {
        const report = await requestAnalytics(
          days,
          controller.signal,
          visitorPage,
        );
        if (!controller.signal.aborted) setData(report);
      } catch (failure) {
        if (!controller.signal.aborted) setError(authErrorMessage(failure));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadAnalytics();
    return () => controller.abort();
  }, [days, refreshVersion, visitorPage]);
  /** Novi period počinje od prve stranice posjetilaca. */
  function handlePeriodChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setDays(Number(event.target.value));
    setVisitorPage(1);
  }

  /** Ponovo čita bazu; osvježavanje ne dodaje preglede ni događaje rezervacije. */
  function handleRefresh() {
    setRefreshVersion(refreshVersion + 1);
  }
  /** Kalendarski datum čita u podne, a serverski timestamp pretvara u lokalni dan. */
  function formatDate(date: string) {
    return new Intl.DateTimeFormat(locale === "mne" ? "sr-Latn-ME" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Podgorica",
    }).format(new Date(date.length > 10 ? date : `${date}T12:00:00Z`));
  }
  const metrics = data
    ? [
        {
          key: "views",
          label: translate("Pregledi profila", "Profile views"),
          value: data.totals.views,
          icon: Eye,
          note: translate(
            "Sva otvaranja, uključujući ponovljene i anonimne posjete",
            "All openings, including repeat and anonymous visits",
          ),
        },
        {
          key: "requests",
          label: translate(
            "Primljeni zahtjevi u periodu",
            "Requests received in period",
          ),
          value: data.totals.requests,
          icon: Inbox,
          note: translate(
            "Svi poslati zahtjevi u periodu, uključujući kasnije potvrđene, otkazane i odbijene. Ovo nije broj zahtjeva na čekanju.",
            "All requests sent in the period, including those later confirmed, cancelled or declined. This is not the waiting count.",
          ),
        },
        {
          key: "confirmed",
          label: translate(
            "Potvrde termina u periodu",
            "Session confirmations in period",
          ),
          value: data.totals.confirmed,
          icon: CalendarCheck2,
          note: translate(
            "Prva potvrda, uključujući stalne termine i listu čekanja",
            "First confirmation, including recurring and waitlist sessions",
          ),
        },
        {
          key: "cancelled",
          label: translate("Otkazivanja", "Cancellations"),
          value: data.totals.cancelled,
          icon: CalendarX2,
          note: translate(
            "Klijent, terapeut ili prekid serije",
            "Client, therapist or stopped series",
          ),
        },
        {
          key: "rescheduled",
          label: translate("Prihvaćena pomjeranja", "Accepted reschedules"),
          value: data.totals.rescheduled,
          icon: CalendarClock,
          note: translate(
            "Klijent je prihvatio novo vrijeme",
            "Client accepted the new time",
          ),
        },
        {
          key: "proposals",
          label: translate(
            "Predlozi novog vremena",
            "Alternative time proposals",
          ),
          value: data.totals.proposals,
          icon: CalendarClock,
          note: translate(
            "Svi poslati predlozi, uključujući neprihvaćene",
            "All proposals, including those not accepted",
          ),
        },
      ]
    : [];
  let chartMaximum = 1;
  if (data)
    for (const day of data.daily)
      chartMaximum = Math.max(chartMaximum, day.views, day.requests);

  return (
    <div className="container page-space analytics-page">
      <Link href="/dashboard" className="back-link">
        <ArrowLeft size={16} />
        {translate("Moj pregled", "My dashboard")}
      </Link>
      <div className="dashboard-intro">
        <div>
          <span className="eyebrow">
            {translate("VAŠ PROFIL U BROJEVIMA", "YOUR PROFILE IN NUMBERS")}
          </span>
          <h1>{translate("Analitika profila", "Profile analytics")}</h1>
          <p>
            {translate(
              "Pratite interesovanje za svoj profil i tok zakazivanja.",
              "Follow interest in your profile and booking activity.",
            )}
          </p>
        </div>
        <div className="analytics-controls">
          <label>
            {translate("Period", "Period")}
            <select value={days} onChange={handlePeriodChange}>
              {[7, 30, 90].map((period) => (
                <option key={period} value={period}>
                  {translate(
                    `Posljednjih ${period} dana`,
                    `Last ${period} days`,
                  )}
                </option>
              ))}
            </select>
          </label>
          <ActionButton
            className="button button-outline"
            pending={loading}
            pendingText={translate("Učitavanje…", "Loading…")}
            onClick={handleRefresh}
          >
            <RefreshCw size={16} />
            {translate("Osvježi analitiku", "Refresh analytics")}
          </ActionButton>
        </div>
      </div>
      {loading && (
        <PendingStatus>
          {translate("Učitavanje analitike…", "Loading analytics…")}
        </PendingStatus>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <AnalyticsCurrentBookings counts={data.currentBookings} />
          <h2>
            {translate(
              "Aktivnost u izabranom periodu",
              "Activity in the selected period",
            )}
          </h2>
          <p className="muted analytics-period">
            {formatDate(data.from)} – {formatDate(data.to)} ·{" "}
            {translate(
              "Europe/Podgorica · prema datumu radnje, a ne datumu seanse",
              "Europe/Podgorica · by activity date, not session date",
            )}
          </p>
          <div className="analytics-metrics">
            {metrics.map((metric) => (
              <article className="analytics-metric" key={metric.key}>
                <metric.icon size={22} aria-hidden="true" />
                <h2>{metric.label}</h2>
                <strong data-testid={`analytics-${metric.key}`}>
                  {metric.value}
                </strong>
                <p>{metric.note}</p>
              </article>
            ))}
          </div>
          <AnalyticsVisitors data={data} onPage={setVisitorPage} />
          <section
            className="analytics-conversion"
            aria-labelledby="conversion-title"
          >
            <div>
              <span className="eyebrow">
                {translate("OD PREGLEDA DO ZAHTJEVA", "FROM VIEW TO REQUEST")}
              </span>
              <h2 id="conversion-title">
                {translate("Konverzija profila", "Profile conversion")}
              </h2>
              <p>
                {translate(
                  "Udio različitih klijenata koji su poslije pregleda vašeg profila poslali zahtjev u izabranom periodu. Stalni termini i automatske dodjele ne ulaze u zahtjeve.",
                  "The share of distinct clients who viewed your profile and then requested a session within the selected period. Recurring sessions and automatic allocations do not count as requests.",
                )}
              </p>
              <p>
                <strong>
                  {data.convertedVisitors} / {data.clientVisitors}
                </strong>{" "}
                {translate(
                  "klijenata je poslalo zahtjev nakon pregleda",
                  "clients requested a session after viewing",
                )}
              </p>
            </div>
            <strong
              className="analytics-rate"
              data-testid="analytics-conversion"
            >
              {data.conversion === null ? "—" : `${data.conversion}%`}
            </strong>
          </section>
          <p className="analytics-note">
            {translate(
              `Svaki pregled i anonimne posjete pratimo od ${formatDate(data.detailedTrackingStartedAt)}. Od ${formatDate(data.trackingStartedAt)} do tada sačuvan je samo po jedan pregled klijenta dnevno. Ranije nepoznata ponavljanja nijesu dodata.`,
              `Every view and anonymous visits are tracked from ${formatDate(data.detailedTrackingStartedAt)}. Between ${formatDate(data.trackingStartedAt)} and that date only one daily client view was recorded. Unknown earlier repeats have not been added.`,
            )}
          </p>
          <section
            className="analytics-activity"
            aria-labelledby="activity-title"
          >
            <h2 id="activity-title">
              <BarChart3 size={22} aria-hidden="true" />
              {translate("Aktivnost po danima", "Daily activity")}
            </h2>
            <p className="muted">
              {translate(
                "Pregledi i novi zahtjevi. Pređite preko stubića za tačne brojeve; svi podaci su i u tabeli ispod.",
                "Views and new requests. Hover over a bar for exact counts; all values are also in the table below.",
              )}
            </p>
            <div className="analytics-legend">
              <span>{translate("Pregledi", "Views")}</span>
              <span>{translate("Zahtjevi", "Requests")}</span>
            </div>
            <div className="analytics-chart" aria-hidden="true">
              {data.daily.map((day) => (
                <div
                  className="analytics-chart-day"
                  key={day.date}
                  title={`${formatDate(day.date)}: ${day.views} ${translate("pregleda", "views")}, ${day.requests} ${translate("zahtjeva", "requests")}`}
                >
                  <span
                    style={{ height: `${(day.views / chartMaximum) * 100}%` }}
                  />
                  <span
                    style={{
                      height: `${(day.requests / chartMaximum) * 100}%`,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="analytics-chart-dates">
              <span>{formatDate(data.from)}</span>
              <span>{formatDate(data.to)}</span>
            </div>
            <details>
              <summary>
                {translate("Pogledaj dnevne podatke", "View daily figures")}
              </summary>
              <div className="analytics-table-scroll">
                <table>
                  <caption>
                    {translate(
                      "Radnje u izabranom periodu",
                      "Activity in the selected period",
                    )}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{translate("Datum", "Date")}</th>
                      {metrics.map((metric) => (
                        <th scope="col" key={metric.key}>
                          {metric.label}
                        </th>
                      ))}
                      <th scope="col">{translate("Odbijanja", "Declines")}</th>
                      <th scope="col">
                        {translate("Različiti posjetioci", "Distinct visitors")}
                      </th>
                      <th scope="col">
                        {translate("Ponovljeni pregledi", "Repeat views")}
                      </th>
                      <th scope="col">
                        {translate("Pregledi klijenata", "Client views")}
                      </th>
                      <th scope="col">
                        {translate("Anonimni pregledi", "Anonymous views")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.daily].reverse().map((day) => (
                      <tr key={day.date}>
                        <th scope="row">{formatDate(day.date)}</th>
                        <td>{day.views}</td>
                        <td>{day.requests}</td>
                        <td>{day.confirmed}</td>
                        <td>{day.cancelled}</td>
                        <td>{day.rescheduled}</td>
                        <td>{day.proposals}</td>
                        <td>{day.declined}</td>
                        <td>{day.uniqueVisitors}</td>
                        <td>{day.repeatViews}</td>
                        <td>{day.clientViews}</td>
                        <td>{day.anonymousViews}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <p className="analytics-note">
            {translate(
              "Potvrda se računa jednom po terminu, čak i ako je kasnije otkazan. Otkazivanja obuhvataju i povučene zahtjeve; odbijanja su odvojena u tabeli. Brojevi predstavljaju radnje u periodu, ne trenutni broj budućih termina.",
              "Each session is counted at its first confirmation, even if later cancelled. Cancellations include withdrawn requests; declines are separate in the table. Figures describe activity during the period, not the current number of upcoming sessions.",
            )}
          </p>
        </>
      )}
    </div>
  );
}
