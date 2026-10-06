// Povezuje ekrane, poslovna pravila i čuvanje. Demo ne poziva server i nije sistem naloga.
"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DemoState,
  Locale,
  Booking,
  BookingAction,
  Therapist,
  RequestInput,
  initialState,
  requestBooking,
  respondBooking,
  cancelByTherapist,
  proposeAlternative,
  expireUnanswered,
  validateWindows,
  DomainError,
} from "@terapeut/domain";
import {
  readDemoState,
  writeDemoState,
  readLocale,
  writeLocale,
  DEMO_STORAGE_KEY,
} from "./demo-storage";
interface DemoContextType {
  state: DemoState | null;
  locale: Locale;
  translate: (mne: string, en: string) => string;
  notice: string;
  setLocale: (locale: Locale) => void;
  request: (therapistId: string, input: RequestInput) => Booking;
  respond: (
    id: string,
    action: BookingAction,
    reason?: string,
    actor?: "client" | "therapist",
  ) => void;
  propose: (id: string, date: string, start: number) => void;
  updateTherapist: (id: string, update: Partial<Therapist>) => void;
  reset: () => void;
}

const DemoContext = createContext<DemoContextType | null>(null);
// Sve stranice dijele ovaj omotač preko app/layout.tsx. Uloge su samo demo pregledi.
/** Učitava podatke u browseru i daje svim stranicama pristup demo stanju i akcijama. */
export function DemoProvider({ children }: { children: ReactNode }) {
  // useState pamti podatke i ponovo crta ekran kada ih promijenimo.
  const [state, setState] = useState<DemoState | null>(null);
  const [locale, changeLocale] = useState<Locale>("mne");
  const [notice, setNotice] = useState("");
  // Ref timeru daje najnoviju vrijednost, bez čekanja da React ponovo prikaže ekran.
  const latestState = useRef<DemoState | null>(null);

  // useCallback daje timeru stalnu funkciju, da se timer ne kreira poslije svake promjene.
  const saveState = useCallback(
    /** Odmah ažurira zajedničke podatke, prikazuje ih i pokušava čuvanje u browseru. */
    function saveState(nextState: DemoState) {
      latestState.current = nextState;
      setState(nextState);
      if (!writeDemoState(nextState)) {
        setNotice("STORAGE_UNAVAILABLE");
      }
    },
    [],
  );
  // Effect radi u browseru nakon prikaza. Na serveru nema localStorage ni window objekta.
  useEffect(() => {
    /** Učitava sačuvane podatke ili probno početno stanje i bilježi već istekle zahtjeve. */
    function loadSavedState() {
      try {
        const savedState = readDemoState();
        saveState(expireState(savedState || initialState()));
      } catch {
        // Nepoznat format ili zabrana čitanja ne smiju spriječiti rad demo verzije.
        saveState(initialState());
        setNotice("STORAGE_RESET");
      }
    }

    /** Reaguje samo na promjene ovog projekta iz drugih tabova istog browsera. */
    function handleStorageChange(event: StorageEvent) {
      if (event.key === DEMO_STORAGE_KEY) {
        loadSavedState();
      }
    }
    /** Timer bilježi zahtjeve bez odgovora i čuva stanje samo ako se nešto promijenilo. */
    function expirePendingRequests() {
      const currentState = latestState.current;
      if (!currentState) {
        return;
      }
      const nextState = expireState(currentState);
      const hasChanges = nextState.bookings.some(
        (booking, index) => booking !== currentState.bookings[index],
      );
      if (hasChanges) {
        saveState(nextState);
      }
    }

    loadSavedState();
    changeLocale(readLocale());
    window.addEventListener("storage", handleStorageChange);
    const timer = window.setInterval(expirePendingRequests, 30000);
    /** Uklanja timer i slušanje drugih tabova kada React prestane da koristi omotač. */
    function stopListening() {
      window.clearInterval(timer);
      window.removeEventListener("storage", handleStorageChange);
    }
    return stopListening;
  }, [saveState]);

  // Jezik dokumenta mora pratiti tekst i nakon ponovnog otvaranja stranice.
  useEffect(() => {
    document.documentElement.lang = locale === "mne" ? "sr-Latn-ME" : "en";
  }, [locale]);
  /** Čita najnovije podatke prije akcije; ako skladište nije dostupno koristi podatke iz memorije. */
  function getCurrentState(): DemoState {
    let currentState = latestState.current;
    try {
      const savedState = readDemoState();
      if (savedState) {
        currentState = savedState;
      }
    } catch {
      // Ako browser odbije čitanje, koristimo posljednje podatke iz memorije.
    }
    if (!currentState) {
      throw new DomainError("NOT_READY");
    }
    return expireState(currentState);
  }
  /** Pronalazi zahtjev po ID-u ili vraća jasnu poslovnu grešku ako ne postoji. */
  function findBooking(currentState: DemoState, id: string): Booking {
    const booking = currentState.bookings.find(
      (candidate) => candidate.id === id,
    );
    if (!booking) {
      throw new DomainError("BOOKING_NOT_FOUND");
    }
    return booking;
  }
  /** Pronalazi profil po ID-u ili vraća grešku prije izmjene podataka. */
  function findTherapist(currentState: DemoState, id: string): Therapist {
    const therapist = currentState.therapists.find(
      (candidate) => candidate.id === id,
    );
    if (!therapist) {
      throw new DomainError("THERAPIST_NOT_FOUND");
    }
    return therapist;
  }
  /** Bira crnogorski ili engleski tekst prema jeziku; ne poziva servis za prevođenje. */
  function translate(mne: string, en: string): string {
    if (locale === "mne") {
      return mne;
    }
    return en;
  }
  /** Mijenja jezik na ekranu i pamti izbor za naredno otvaranje stranice. */
  function setLocale(language: Locale): void {
    changeLocale(language);
    writeLocale(language);
  }
  /** Poziva poslovnu provjeru iz domain paketa i čuva novu listu sa nastalim zahtjevom. */
  function createRequest(therapistId: string, input: RequestInput): Booking {
    const currentState = getCurrentState();
    const therapist = findTherapist(currentState, therapistId);
    const booking = requestBooking(therapist, input, currentState.bookings);
    saveState({
      ...currentState,
      bookings: [booking, ...currentState.bookings],
    });
    return booking;
  }
  /** Poziva odgovarajuću akciju za zahtjev i čuva rezultat bez izmjene drugih zahtjeva. */
  function respondToRequest(
    id: string,
    action: BookingAction,
    reason?: string,
    actor: "client" | "therapist" = "client",
  ): void {
    const currentState = getCurrentState();
    const booking = findBooking(currentState, id);
    let updatedBooking: Booking;
    if (action === "cancel" && actor === "therapist") {
      updatedBooking = cancelByTherapist(booking, new Date(), reason);
    } else {
      updatedBooking = respondBooking(booking, action, new Date(), reason);
    }
    saveState({
      ...currentState,
      bookings: replaceBooking(currentState.bookings, updatedBooking),
    });
  }
  /** Čuva provjereni predlog B jednom izmjenom, tako da A i B ne ostanu istovremeno zauzeti. */
  function proposeNewTime(id: string, date: string, start: number): void {
    const currentState = getCurrentState();
    const booking = findBooking(currentState, id);
    const therapist = findTherapist(currentState, booking.therapistId);
    const updatedBooking = proposeAlternative(
      booking,
      therapist,
      date,
      start,
      currentState.bookings,
    );
    saveState({
      ...currentState,
      bookings: replaceBooking(currentState.bookings, updatedBooking),
    });
  }
  /** Provjerava trajanje, cijene i raspored i čuva izmjene jednog probnog profila. */
  function updateTherapist(id: string, update: Partial<Therapist>): void {
    const currentState = getCurrentState();
    const original = findTherapist(currentState, id);
    const updatedTherapist = { ...original, ...update };
    validateWindows(updatedTherapist.availability);
    for (const service of updatedTherapist.services) {
      const validName = service.name.trim().length > 0;
      const validDuration =
        Number.isInteger(service.duration) &&
        service.duration >= 5 &&
        service.duration <= 240;
      const validPrice =
        service.price === null ||
        (Number.isFinite(service.price) && service.price >= 0);
      if (!validName || !validDuration || !validPrice) {
        throw new DomainError("INVALID_SERVICE");
      }
    }
    // Ovo je demo akcija. Produkcioni API mora odvojeno provjeravati admin/terapeut dozvole.
    const updatedProfiles = currentState.therapists.map((therapist) => {
      if (therapist.id === id) {
        return updatedTherapist;
      }
      return therapist;
    });
    saveState({ ...currentState, therapists: updatedProfiles });
  }
  /** Vraća izmišljene početne podatke za ponovno isprobavanje demo verzije. */
  function reset(): void {
    saveState(initialState());
    setNotice("");
  }

  // Ovdje povezujemo imena koja komponente koriste sa funkcijama iznad.
  return (
    <DemoContext.Provider
      value={{
        state,
        locale,
        translate,
        notice,
        setLocale,
        request: createRequest,
        respond: respondToRequest,
        propose: proposeNewTime,
        updateTherapist,
        reset,
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}
/** Vraća kopiju stanja sa zabilježenim isteklim zahtjevima. */
function expireState(currentState: DemoState): DemoState {
  return { ...currentState, bookings: expireUnanswered(currentState.bookings) };
}

/** Pravi novu listu: zamjenjuje zahtjev istog ID-a, bez brisanja istorije drugih zahtjeva. */
function replaceBooking(
  bookings: Booking[],
  updatedBooking: Booking,
): Booking[] {
  return bookings.map((booking) => {
    if (booking.id === updatedBooking.id) {
      return updatedBooking;
    }
    return booking;
  });
}
/** Daje komponenti podatke i akcije iz najbližeg DemoProvider omotača. */
export function useDemo(): DemoContextType {
  const context = useContext(DemoContext);
  if (!context) {
    throw new Error(
      "Komponenta koja koristi useDemo mora biti unutar DemoProvider-a.",
    );
  }
  return context;
}
