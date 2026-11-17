"use client";
import type { ProfileAnalytics, ProfileViewerKind } from "@terapeut/domain";
import { useDemo } from "@/lib/demo-context";

/** Prikazuje sve preglede, različite posjetioce i ponavljanja, bez otkrivanja njihovih naloga. */
export function AnalyticsVisitors({
  data,
  onPage,
}: {
  data: ProfileAnalytics;
  onPage: (page: number) => void;
}) {
  const { translate, locale } = useDemo();
  /** Naziv grupe razdvaja klijente, anonimne browsere, druge naloge i vlastite preglede. */
  function audienceName(kind: ProfileViewerKind) {
    if (kind === "CLIENT")
      return translate("Prijavljeni klijenti", "Signed-in clients");
    if (kind === "ANONYMOUS")
      return translate("Neprijavljeni posjetioci", "Anonymous visitors");
    if (kind === "SELF")
      return translate("Vaši sopstveni pregledi", "Your own views");
    return translate("Ostali prijavljeni nalozi", "Other signed-in accounts");
  }
  /** Vrijeme čita u istoj zoni kao API, uključujući promjenu ljetnjeg računanja vremena. */
  function formatTime(value: string) {
    return new Intl.DateTimeFormat(locale === "mne" ? "sr-Latn-ME" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Podgorica",
    }).format(new Date(value));
  }
  const summary = data.visitorSummary;
  const metrics = [
    {
      key: "unique",
      label: translate("Različiti posjetioci", "Distinct visitors"),
      value: data.uniqueVisitors,
      note: translate(
        "Svaki nalog ili anonimni browser jednom u periodu",
        "Each account or anonymous browser counted once in the period",
      ),
    },
    {
      key: "repeat",
      label: translate("Ponovljeni pregledi", "Repeat views"),
      value: summary.repeatViews,
      note: translate(
        "Sva otvaranja poslije prvog otvaranja istog posjetioca u periodu",
        "All views after each visitor's first view in the period",
      ),
    },
    {
      key: "returning",
      label: translate(
        "Posjetioci sa više pregleda",
        "Visitors with multiple views",
      ),
      value: summary.returningVisitors,
      note: translate(
        "Koliko posjetilaca je otvorilo profil najmanje dva puta u periodu",
        "Visitors with at least two views in the period",
      ),
    },
    {
      key: "once",
      label: translate(
        "Posjetioci sa jednim pregledom",
        "Visitors with one view",
      ),
      value: summary.oneTimeVisitors,
      note: translate(
        "Otvorili su profil tačno jednom u periodu",
        "Exactly one view in the period",
      ),
    },
    {
      key: "new",
      label: translate("Prvi put zabilježeni", "First-time visitors"),
      value: summary.newVisitors,
      note: translate(
        "Prvi zabilježeni pregled je u ovom periodu",
        "First recorded view is within this period",
      ),
    },
    {
      key: "known",
      label: translate("Ranije zabilježeni", "Previously recorded visitors"),
      value: data.uniqueVisitors - summary.newVisitors,
      note: translate(
        "Pregledali su profil i prije početka ovog perioda",
        "Also viewed the profile before this period",
      ),
    },
    {
      key: "average",
      label: translate(
        "Prosjek pregleda po posjetiocu",
        "Average views per visitor",
      ),
      value: new Intl.NumberFormat(locale === "mne" ? "sr-Latn-ME" : "en-GB", {
        maximumFractionDigits: 2,
      }).format(summary.averageViews),
      note: translate(
        "Ukupan broj pregleda / različiti posjetioci",
        "Total views / distinct visitors",
      ),
    },
    {
      key: "maximum",
      label: translate(
        "Najviše pregleda jednog posjetioca",
        "Most views by one visitor",
      ),
      value: summary.mostViews,
      note: translate(
        "Najveći broj otvaranja istog posjetioca u periodu",
        "Highest view count from one visitor in the period",
      ),
    },
  ];
  return (
    <section className="analytics-visitors" aria-labelledby="visitors-title">
      <h2 id="visitors-title">
        {translate(
          "Ko se vraća na vaš profil?",
          "Who comes back to your profile?",
        )}
      </h2>
      <p className="analytics-note">
        {translate(
          "Svako novo otvaranje ili osvježavanje profila je novi pregled, čak i kada je posjetilac isti. Različiti posjetioci i ponovljeni pregledi prikazani su zasebno.",
          "Each new profile opening or reload counts as a view, including repeat visits. Distinct visitors and repeat views are shown separately.",
        )}
      </p>
      <div className="analytics-metrics">
        {metrics.map((metric) => (
          <article className="analytics-metric" key={metric.key}>
            <h3>{metric.label}</h3>
            <strong data-testid={`visitors-${metric.key}`}>
              {metric.value}
            </strong>
            <p>{metric.note}</p>
          </article>
        ))}
      </div>
      <div className="analytics-activity analytics-audiences">
        <h3>
          {translate(
            "Pregledi prema vrsti posjetioca",
            "Views by visitor group",
          )}
        </h3>
        <div className="analytics-table-scroll">
          <table>
            <caption>
              {translate(
                "Prijavljeni i neprijavljeni posjetioci su odvojeni",
                "Signed-in and anonymous visitors are separate",
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">{translate("Grupa", "Group")}</th>
                <th scope="col">{translate("Svi pregledi", "All views")}</th>
                <th scope="col">
                  {translate("Različiti posjetioci", "Distinct visitors")}
                </th>
                <th scope="col">
                  {translate("Ponovljeni pregledi", "Repeat views")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.audiences.map((group) => (
                <tr key={group.kind}>
                  <th scope="row">{audienceName(group.kind)}</th>
                  <td data-testid={`audience-${group.kind}-views`}>
                    {group.views}
                  </td>
                  <td>{group.visitors}</td>
                  <td>{group.repeatViews}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="analytics-activity analytics-individuals">
        <h3>
          {translate(
            "Koliko puta je isti posjetilac otvorio profil?",
            "How often did each visitor open your profile?",
          )}
        </h3>
        <p className="analytics-note">
          {translate(
            "Oznake poput „Posjetilac 1“ važe samo za vaš profil. Imena, email adrese i identifikatori naloga se ne prikazuju. Redosljed ide od najvećeg broja pregleda.",
            "Labels such as “Visitor 1” apply only to your profile. Names, email addresses and account identifiers are not shown. Visitors are ordered by view count.",
          )}
        </p>
        {data.visitors.length === 0 ? (
          <p>
            {translate(
              "Još nema zabilježenih pregleda u ovom periodu.",
              "No views recorded in this period yet.",
            )}
          </p>
        ) : (
          <div className="analytics-table-scroll">
            <table>
              <caption>
                {translate(
                  "Broj pregleda po posjetiocu u izabranom periodu",
                  "Views per visitor in the selected period",
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{translate("Posjetilac", "Visitor")}</th>
                  <th scope="col">{translate("Grupa", "Group")}</th>
                  <th scope="col">{translate("Pregledi", "Views")}</th>
                  <th scope="col">{translate("Ponovljeni", "Repeat views")}</th>
                  <th scope="col">
                    {translate("Aktivni dani", "Active days")}
                  </th>
                  <th scope="col">
                    {translate(
                      "Prvi pregled u periodu",
                      "First view in period",
                    )}
                  </th>
                  <th scope="col">
                    {translate("Posljednji pregled", "Last view")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.visitors.map((visitor) => (
                  <tr key={visitor.number}>
                    <th scope="row">
                      {translate(
                        `Posjetilac ${visitor.number}`,
                        `Visitor ${visitor.number}`,
                      )}
                    </th>
                    <td>{audienceName(visitor.kind)}</td>
                    <td>{visitor.views}</td>
                    <td>{visitor.views - 1}</td>
                    <td>{visitor.activeDays}</td>
                    <td>{formatTime(visitor.firstViewedAt)}</td>
                    <td>{formatTime(visitor.lastViewedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.visitorPages > 1 && (
          <nav
            className="analytics-pagination"
            aria-label={translate("Stranice posjetilaca", "Visitor pages")}
          >
            <button
              type="button"
              className="button button-outline button-sm"
              disabled={data.visitorPage <= 1}
              onClick={() => onPage(data.visitorPage - 1)}
            >
              {translate("Prethodna", "Previous")}
            </button>
            <span>
              {data.visitorPage} / {data.visitorPages}
            </span>
            <button
              type="button"
              className="button button-outline button-sm"
              disabled={data.visitorPage >= data.visitorPages}
              onClick={() => onPage(data.visitorPage + 1)}
            >
              {translate("Sljedeća", "Next")}
            </button>
          </nav>
        )}
      </div>
      <p className="analytics-note">
        {translate(
          "Neprijavljene posjetioce razlikujemo pomoću kolačića browsera koji traje 30 dana. Drugi browser, obrisan kolačić ili kasnija prijava mogu istu osobu prikazati kao više posjetilaca. Klikovi u aplikaciji koji ne otvaraju profil nijesu pregledi profila.",
          "Anonymous visitors are distinguished using a 30-day browser cookie. Another browser, a cleared cookie or signing in later can count the same person as multiple visitors. App clicks that do not open a profile are not profile views.",
        )}
      </p>
    </section>
  );
}
