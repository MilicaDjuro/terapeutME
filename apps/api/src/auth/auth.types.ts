export interface RegistrationInput {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  password: string;
}

export interface AccountProfileInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  title?: string;
  biography?: string;
}

export interface TherapistProfileInput {
  title: string;
  biography: string;
  city: string;
  address: string | null;
  phone: string;
}

export interface TherapistRegistrationDetails extends TherapistProfileInput {
  online?: boolean;
  serviceName: string;
  durationMinutes: number;
  priceEur: number | null;
}

export interface TherapistDetailsRow {
  online: boolean;
  title: string;
  biography: string;
  city: string;
  address: string | null;
  phone: string;
  service_name: string;
  duration_minutes: number;
  price_eur: string | null;
}

export interface TherapistAccountProfile {
  id: string;
  name: string;
  title: string;
  biography: string;
  city: string;
  address: string | null;
  phone: string | null;
  verified: boolean;
  publicId: string;
  photos: { id: string; url: string; primary: boolean }[];
  services: {
    id: string;
    name: string;
    durationMinutes: number;
    priceEur: number | null;
    online: boolean;
  }[];
}

// Samo ova polja smiju napustiti API; hash lozinke i tokeni nijesu dio korisničkog prikaza.
export interface AccountUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  role: "CLIENT" | "THERAPIST" | "ADMIN";
}

export interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  role: AccountUser["role"];
  password_hash: string;
  verified_at: Date | null;
  suspended_at: Date | null;
}

export interface RegistrationRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  password_hash: string;
  code_hash: string;
  failed_attempts: number;
  expires_at: Date;
  next_send_at: Date;
  sent_at: Date | null;
  created_at: Date;
  registration_role: "CLIENT" | "THERAPIST";
}
