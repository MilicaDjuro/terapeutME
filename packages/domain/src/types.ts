// Oblik zajedničkih podataka. Ovdje nema Reacta, Next.js niti pristupa bazi.
export type Locale = "mne" | "en";

// Akcija je ono što korisnik radi; status je stanje zahtjeva nakon akcije.
export type BookingAction =
  | "confirm"
  | "decline"
  | "cancel"
  | "accept-alternative"
  | "reject-alternative"
  | "complete"
  | "no-show";

// Vrijeme čuvamo kao minute od ponoći: 16:00 = 960, 16:15 = 975.
export interface TimeRange {
  start: number;
  end: number;
}

// REQUESTED i ALTERNATIVE_PROPOSED već zauzimaju vrijeme, iako nijesu potvrđeni.
export type BookingStatus =
  | "REQUESTED"
  | "ALTERNATIVE_PROPOSED"
  | "CONFIRMED"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED_PROVIDER"
  | "EXPIRED_CLIENT"
  | "COMPLETED"
  | "NO_SHOW";
// `price: null` znači „Na upit“, a 0 znači besplatno.
export interface Service {
  id: string;
  name: string;
  nameEn: string;
  duration: number;
  price: number | null;
  active: boolean;
}
// Sedmični raspored: weekday 0 = nedjelja, 1 = ponedjeljak, ... 6 = subota.
export interface AvailabilityWindow {
  id: string;
  weekday: number;
  start: number;
  end: number;
}
// Jedan konkretan datum ima prednost nad sedmicnim rasporedom; working=false znaci neradni dan.
export interface DateAvailability {
  id: string;
  date: string;
  working: boolean;
  start: number;
  end: number;
}
// Blokada na određenom datumu, npr. pauza. Trenutno nema poseban editor.
export interface BlockedInterval {
  id: string;
  date: string;
  start: number;
  end: number;
}
// Profil, usluge i raspored terapeuta. Admin upravlja verified i active poljima.
export interface Therapist {
  id: string;
  name: string;
  title: string;
  titleEn: string;
  city: string;
  address: string;
  bio: string;
  bioEn: string;
  profession: "psychologist" | "psychotherapist" | "psychiatrist";
  approaches: string[];
  approachesEn: string[];
  languages: string[];
  education: string;
  educationEn: string;
  verified: boolean;
  active: boolean;
  acceptingClients: boolean;
  color: string;
  initials: string;
  services: Service[];
  availability: AvailabilityWindow[];
  dateAvailability?: DateAvailability[];
  blocked: BlockedInterval[];
  photos?: { id: string; url: string; primary: boolean }[];
}
// Jedan zapis istorije, uključujući prethodni termin kod promjene A → B.
export interface BookingEvent {
  at: string;
  actor: "client" | "therapist" | "system";
  action: string;
  from: BookingStatus | null;
  to: BookingStatus;
  reason?: string;
  previousDate?: string;
  previousStart?: number;
}
// Kopija cijene i trajanja ostaje ista i kada se usluga naknadno promijeni.
export interface Booking {
  id: string;
  therapistId: string;
  serviceId: string;
  serviceName: string;
  serviceNameEn: string;
  duration: number;
  price: number | null;
  date: string;
  start: number;
  end: number;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  status: BookingStatus;
  createdAt: string;
  events: BookingEvent[];
  // Pravilo serije se ne pomjera kada se promijeni samo jedna seansa.
  series?: {
    id: string;
    intervalDays: number;
    originalDate: string;
    originalStart: number;
    active: boolean;
  } | null;
}
// Svi demo podaci iz browsera. Verzija omogućava kasniju promjenu formata.
export interface DemoState {
  version: 1;
  therapists: Therapist[];
  bookings: Booking[];
}
export class DomainError extends Error {
  /** Pravi poslovnu grešku sa oznakom koju frontend može prevesti u jasnu poruku. */
  constructor(public code: string) {
    // Frontend oznaku code pretvara u poruku korisniku u lib/errors.ts.
    super(code);
    this.name = "DomainError";
  }
}

// Zajednički oblik zbirne analitike: API i prikaz koriste ista imena i brojeve.
export interface ProfileAnalyticsCounts {
  views: number;
  requests: number;
  confirmed: number;
  cancelled: number;
  proposals: number;
  rescheduled: number;
  declined: number;
}
export interface ProfileAnalytics {
  currentBookings: {
    total: number;
    waiting: number;
    awaitingTherapist: number;
    awaitingClient: number;
    confirmed: number;
    history: number;
  };
  from: string;
  to: string;
  trackingStartedAt: string;
  totals: ProfileAnalyticsCounts;
  daily: (ProfileAnalyticsCounts & {
    date: string;
    uniqueVisitors: number;
    repeatViews: number;
    clientViews: number;
    anonymousViews: number;
  })[];
  uniqueVisitors: number;
  convertedVisitors: number;
  conversion: number | null;
  detailedTrackingStartedAt: string;
  clientVisitors: number;
  visitorSummary: {
    repeatViews: number;
    returningVisitors: number;
    oneTimeVisitors: number;
    newVisitors: number;
    averageViews: number;
    mostViews: number;
  };
  audiences: {
    kind: ProfileViewerKind;
    views: number;
    visitors: number;
    repeatViews: number;
  }[];
  visitors: {
    number: number;
    kind: ProfileViewerKind;
    views: number;
    activeDays: number;
    firstViewedAt: string;
    lastViewedAt: string;
  }[];
  visitorPage: number;
  visitorPages: number;
}
export type ProfileViewerKind = "CLIENT" | "ANONYMOUS" | "OTHER" | "SELF";
