"use client";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { useDemo } from "@/lib/demo-context";
/** Prikazuje objašnjenja zakazivanja kroz pitanja koja korisnik može otvoriti. */
export default function FAQ() {
  const { translate } = useDemo();
  const items = [
    [
      translate("Kako da zakažem susret?", "How do I request a session?"),
      translate(
        "Otvorite profil stručnjaka, izaberite uslugu i slobodan termin u kalendaru. Pošaljite zahtjev sa kontakt podacima. Termin je zauzet dok čekate odgovor terapeuta.",
        "Open a professional’s profile, choose a service and an available time in the calendar. Submit a request with your contact details. The time is held while you await a response.",
      ),
    ],
    [
      translate(
        "Da li je poslati zahtjev potvrđen termin?",
        "Is a submitted request a confirmed appointment?",
      ),
      translate(
        "Ne. Termin je potvrđen kada terapeut prihvati zahtjev ili kada vi prihvatite drugi termin koji je terapeut predložio.",
        "No. Your appointment is confirmed when the therapist accepts your request or when you accept an alternative time proposed by the therapist.",
      ),
    ],
    [
      translate(
        "Šta ako terapeut predloži drugo vrijeme?",
        "What if my therapist proposes another time?",
      ),
      translate(
        "Prethodni termin se oslobađa, a novi čuva za vas dok ga ne prihvatite ili odbijete. Predlog možete vidjeti u svom pregledu.",
        "Your previous time is released and the new time held for you until you accept or decline. View the proposal in your dashboard.",
      ),
    ],
    [
      translate("Mogu li otkazati?", "Can I cancel?"),
      translate(
        "Možete povući zahtjev ili otkazati potvrđen termin. Razlog je opcionalan. U ovoj demo verziji email obavještenja se ne šalju.",
        "You can withdraw a request or cancel a confirmed appointment. A reason is optional. Email notifications are not sent in this demo.",
      ),
    ],
    [
      translate("Da li su seanse online?", "Are sessions online?"),
      translate(
        "Da, za usluge označene kao online kada je video servis uključen. Nakon potvrde termina otvorite čekaonicu iz svojih rezervacija, najranije 10 minuta prije početka. Terapeut pokreće razgovor kada su terapeut i klijent spremni; čekanje ne uključuje video poziv.",
        "Yes, for services marked online when the video service is enabled. After confirmation, open the waiting room from your bookings, starting 10 minutes before the appointment. The therapist starts when both participants are ready; waiting does not connect a video call.",
      ),
    ],
    [
      translate(
        "Ko vidi moje kontakt podatke?",
        "Who sees my contact details?",
      ),
      translate(
        "Terapeut kome šaljete zahtjev vidi vaše ime i prezime, email i broj telefona. Za isprobavanje demo verzije koristite probne podatke.",
        "The therapist receiving your request sees your full name, email and phone number. Use sample details when exploring this demo.",
      ),
    ],
  ];
  return (
    <div className="container page-space reading-page">
      <div className="page-intro">
        <span className="eyebrow">
          {translate("TU SMO DA RAZJASNIMO", "HERE TO HELP")}
        </span>
        <h1>
          {translate(
            "Prvi korak, bez nedoumica.",
            "A first step, with clarity.",
          )}
        </h1>
        <p>
          {translate(
            "Odgovori na pitanja o izboru stručnjaka i zakazivanju.",
            "Answers about finding a professional and requesting a session.",
          )}
        </p>
      </div>
      <div className="faq-list">
        {items.map(([question, answer]) => (
          <details key={question}>
            <summary>
              {question}
              <Plus size={17} />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
      <div className="info-note">
        {translate(
          "Terapeut.me nije služba za hitnu pomoć. Ako ste u neposrednoj opasnosti, obratite se lokalnoj hitnoj službi.",
          "Terapeut.me is not an emergency service. If you are in immediate danger, contact local emergency services.",
        )}
      </div>
      <Link href="/psychotherapy" className="button button-primary">
        {translate("Pronađi stručnjaka", "Find a professional")}
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
