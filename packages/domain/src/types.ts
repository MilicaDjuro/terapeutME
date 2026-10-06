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
  blocked: BlockedInterval[];
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
