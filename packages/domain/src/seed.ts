// Samo izmišljeni demo podaci. Njihovo korišćenje ne kreira nalog ni podatke u PostgreSQL-u.
import { AvailabilityWindow, Booking, DemoState, Therapist } from "./types";
import { addDays, dateKey, weekday } from "./scheduling";
import { requestBooking, respondBooking } from "./bookings";
/** Pravi pet probnih perioda dostupnosti, od ponedjeljka do petka, sa istim satima. */
function workingWeek(start: number, end: number): AvailabilityWindow[] {
  const windows: AvailabilityWindow[] = [];
  for (let day = 1; day <= 5; day++) {
    windows.push({ id: `day-${day}`, weekday: day, start, end });
  }
  return windows;
}
export const therapists: Therapist[] = [
  {
    id: "ana-markovic",
    name: "Ana Marković",
    title: "Psihološkinja · psihoterapeutkinja",
    titleEn: "Psychologist · psychotherapist",
    city: "Podgorica",
    address: "Bulevar Svetog Petra Cetinjskog, Podgorica",
    bio: "Vjerujem da promjena počinje kada imamo prostor da budemo ono što jesmo. Kroz topao i podržavajući odnos pomažem odraslima da bolje razumiju svoje emocije, odnose i životne promjene.",
    bioEn:
      "I believe change begins when we have space to be ourselves. Through a warm, supportive relationship, I help adults better understand their emotions, relationships and life transitions.",
    profession: "psychologist",
    approaches: ["Geštalt", "Individualni rad"],
    approachesEn: ["Gestalt", "Individual therapy"],
    languages: ["Crnogorski", "English"],
    education:
      "Psihologija · Univerzitet Crne Gore\nEdukacija iz geštalt psihoterapije",
    educationEn:
      "Psychology · University of Montenegro\nGestalt psychotherapy training",
    verified: true,
    active: true,
    acceptingClients: true,
    initials: "AM",
    color: "sage",
    services: [
      {
        id: "ana-individual",
        name: "Individualna seansa",
        nameEn: "Individual session",
        duration: 60,
        price: 45,
        active: true,
      },
      {
        id: "ana-intro",
        name: "Uvodni razgovor",
        nameEn: "Introductory session",
        duration: 30,
        price: null,
        active: true,
      },
    ],
    availability: workingWeek(960, 1200),
    blocked: [],
  },
  {
    id: "milica-jovanovic",
    name: "Milica Jovanović",
    title: "Psihoterapeutkinja",
    titleEn: "Psychotherapist",
    city: "Nikšić",
    address: "Centar, Nikšić",
    bio: "Radim sa osobama koje se suočavaju sa stresom, nesigurnošću i teškoćama u odnosima. Zajedno istražujemo obrasce i gradimo prostor za nove izbore, vašim tempom.",
    bioEn:
      "I work with people navigating stress, uncertainty and relationship difficulties. Together, we explore patterns and make room for new choices, at your own pace.",
    profession: "psychotherapist",
    approaches: ["Kognitivno-bihejvioralni pristup", "Individualni rad"],
    approachesEn: ["Cognitive behavioural therapy", "Individual therapy"],
    languages: ["Crnogorski"],
    education: "Edukacija iz kognitivno-bihejvioralne psihoterapije",
    educationEn: "Cognitive behavioural psychotherapy training",
    verified: true,
    active: true,
    acceptingClients: true,
    initials: "MJ",
    color: "peach",
    services: [
      {
        id: "milica-individual",
        name: "Individualna seansa",
        nameEn: "Individual session",
        duration: 50,
        price: 40,
        active: true,
      },
    ],
    availability: workingWeek(600, 960),
    blocked: [],
  },
  {
    id: "jelena-petrovic",
    name: "Jelena Petrović",
    title: "Psihijatrica",
    titleEn: "Psychiatrist",
    city: "Bar",
    address: "Centar, Bar",
    bio: "Posvećena sam razumijevanju svake osobe i njenog životnog konteksta. Pregled je prilika za razgovor, procjenu i dogovor o narednim koracima podrške.",
    bioEn:
      "I am committed to understanding each person and their life context. An appointment is an opportunity for conversation, assessment and planning the next steps of support.",
    profession: "psychiatrist",
    approaches: ["Psihijatrijska procjena", "Savjetovanje"],
    approachesEn: ["Psychiatric assessment", "Counselling"],
    languages: ["Crnogorski", "English"],
    education: "Medicinski fakultet · specijalizacija iz psihijatrije",
    educationEn: "Medical degree · psychiatry specialisation",
    verified: false,
    active: true,
    acceptingClients: true,
    initials: "JP",
    color: "lavender",
    services: [
      {
        id: "jelena-first",
        name: "Prvi pregled",
        nameEn: "Initial appointment",
        duration: 45,
        price: 60,
        active: true,
      },
      {
        id: "jelena-followup",
        name: "Kontrolni pregled",
        nameEn: "Follow-up appointment",
        duration: 30,
        price: null,
        active: true,
      },
    ],
    availability: workingWeek(900, 1140),
    blocked: [],
  },
  {
    id: "maja-radovic",
    name: "Maja Radović",
    title: "Psihološkinja · psihoterapeutkinja",
    titleEn: "Psychologist · psychotherapist",
    city: "Budva",
    address: "Centar, Budva",
    bio: "Podržavam odrasle i parove u pronalaženju više razumijevanja, bliskosti i ravnoteže. Važno mi je da se u razgovoru osjećate saslušano i prihvaćeno.",
    bioEn:
      "I support adults and couples in finding more understanding, connection and balance. It matters to me that you feel heard and accepted in our conversations.",
    profession: "psychologist",
    approaches: ["Sistemski pristup", "Rad sa parovima"],
    approachesEn: ["Systemic therapy", "Couples therapy"],
    languages: ["Crnogorski", "English"],
    education: "Psihologija · edukacija iz sistemske porodične psihoterapije",
    educationEn: "Psychology · systemic family psychotherapy training",
    verified: true,
    active: true,
    acceptingClients: true,
    initials: "MR",
    color: "sand",
    services: [
      {
        id: "maja-individual",
        name: "Individualna seansa",
        nameEn: "Individual session",
        duration: 60,
        price: 50,
        active: true,
      },
      {
        id: "maja-couples",
        name: "Seansa za parove",
        nameEn: "Couples session",
        duration: 90,
        price: 70,
        active: true,
      },
    ],
    availability: workingWeek(720, 1080),
    blocked: [],
  },
];
/** Pravi izmišljene profile i zahtjeve za prvi prikaz ili reset demo verzije. */
export function initialState(now = new Date()): DemoState {
  let day = addDays(dateKey(now), 1);
  while ([0, 6].includes(weekday(day))) day = addDays(day, 1);
  const contact = {
    clientName: "Demo klijent",
    clientEmail: "klijent@example.test",
    clientPhone: "+382 67 000 000",
  };
  const pending = requestBooking(
    therapists[0],
    { ...contact, serviceId: "ana-individual", date: day, start: 960 },
    [],
    now,
    "demo-pending",
  );
  const requested = requestBooking(
    therapists[1],
    { ...contact, serviceId: "milica-individual", date: day, start: 660 },
    [pending],
    now,
    "demo-confirmed",
  );
  const confirmed = respondBooking(requested, "confirm", now);
  const previous = addDays(dateKey(now), -1);
  const history: Booking = {
    ...confirmed,
    id: "demo-completed",
    date: previous,
    status: "COMPLETED",
    events: [
      ...confirmed.events,
      {
        at: now.toISOString(),
        actor: "therapist",
        action: "OUTCOME_UPDATED",
        from: "CONFIRMED",
        to: "COMPLETED",
      },
    ],
  };
  return {
    version: 1,
    therapists: structuredClone(therapists),
    bookings: [pending, confirmed, history],
  };
}
