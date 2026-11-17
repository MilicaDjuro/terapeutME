"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AccountUser,
  AuthRequestError,
  authErrorMessage,
  requestAuth,
} from "./auth-client";

interface AuthContextValue {
  user: AccountUser | null;
  loading: boolean;
  error: string;
  setUser: (user: AccountUser | null) => void;
  refreshAccount: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);

/** Učitava stvarni nalog iz serverske sesije; podatke ne upisuje u localStorage. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, updateUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latestRequest = useRef<AbortController | null>(null);

  /** Pri prijavi/odjavi odbacuje staro učitavanje da ono ne pregazi noviji identitet. */
  function setUser(account: AccountUser | null) {
    latestRequest.current?.abort();
    updateUser(account);
    setError("");
    setLoading(false);
  }

  /** Provjerava sesiju; provjera pri povratku u tab čuva otvoreni formular dok čeka odgovor. */
  const refreshAccount = useCallback(async function refreshAccount(
    showLoading = true,
  ) {
    latestRequest.current?.abort();
    const controller = new AbortController();
    latestRequest.current = controller;
    if (showLoading) {
      setLoading(true);
      setError("");
    }
    try {
      const response = await requestAuth("me", undefined, controller.signal);
      if (!controller.signal.aborted) {
        updateUser(response.user || null);
        setError("");
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      updateUser(null);
      if (!(failure instanceof AuthRequestError && failure.status === 401))
        setError(authErrorMessage(failure));
      else setError("");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Identitet učitavamo pri otvaranju i povratku u tab; cleanup prekida HTTP i slušače.
  useEffect(() => {
    /** Provjerava sesiju kad korisnik ponovo otvori tab, uključujući odjavu iz drugog taba. */
    function handleVisibility() {
      if (document.visibilityState === "visible") void refreshAccount(false);
    }
    void refreshAccount();
    document.addEventListener("visibilitychange", handleVisibility);
    /** Uklanja lifecycle radnje kada zajednički provider više nije prikazan. */
    function stopLoading() {
      latestRequest.current?.abort();
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    return stopLoading;
  }, [refreshAccount]);

  return (
    <AuthContext.Provider
      value={{ user, loading, error, setUser, refreshAccount }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Daje komponente prijave i naloga; demo uloge ostaju u zasebnom DemoProvider-u. */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth zahtijeva AuthProvider.");
  return context;
}
