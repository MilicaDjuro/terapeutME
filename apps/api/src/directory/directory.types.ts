// Javni HTTP oblik prati domain model i ne sadrži privatne podatke naloga.
export interface PublicTherapist {
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
  ratingTotal: number;
  ratingCount: number;
  color: string;
  initials: string;
  services: {
    id: string;
    name: string;
    nameEn: string;
    duration: number;
    price: number | null;
    active: boolean;
    online: boolean;
  }[];
  availability: { id: string; weekday: number; start: number; end: number }[];
  dateAvailability: {
    id: string;
    date: string;
    working: boolean;
    start: number;
    end: number;
  }[];
  blocked: { id: string; date: string; start: number; end: number }[];
  photos?: TherapistPhoto[];
}
export interface TherapistPhoto {
  id: string;
  url: string;
  primary: boolean;
}

/** Pravi javnu adresu fotografije; bajtovi slike ostaju u PostgreSQL-u. */
export function photoView(row: {
  id: string;
  is_primary: boolean;
}): TherapistPhoto {
  return {
    id: row.id,
    url: `/api/v1/therapist-photos/${row.id}`,
    primary: row.is_primary,
  };
}
