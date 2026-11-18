import type { NextConfig } from "next";

// Vercel ugrađuje odredište proxy-ja tokom build-a, pa pogrešnu adresu odmah odbijamo.
const apiOrigin = process.env.API_ORIGIN || "http://127.0.0.1:4000";
if (process.env.VERCEL === "1" && !process.env.API_ORIGIN) {
  throw new Error("Podesite API_ORIGIN na Vercelu prije build-a.");
}
const apiAddress = new URL(apiOrigin);
if (
  !["http:", "https:"].includes(apiAddress.protocol) ||
  apiAddress.origin !== apiOrigin ||
  (process.env.VERCEL === "1" && apiAddress.protocol !== "https:")
) {
  throw new Error(
    "API_ORIGIN mora biti origin bez putanje; Vercel zahtijeva HTTPS.",
  );
}
// Podešavanja frontend frameworka. Stranice i poslovna pravila nijesu u ovom fajlu.
const config: NextConfig = {
  // Zajednički paket sadrži TypeScript, pa Next.js treba i njega da kompajlira.
  transpilePackages: ["@terapeut/domain"],
  poweredByHeader: false,
  // Browser auth testovi koriste poseban izlaz da ne zaključaju razvojni sajt korisnika.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Izolovani browser testovi ne čuvaju dodatni disk cache; razvojni sajt ga i dalje koristi.
  experimental: {
    turbopackFileSystemCacheForDev:
      process.env.NEXT_DIST_DIR !== ".next-auth-e2e",
  },
  /** Prosljeđuje auth zahtjeve NestJS-u sa iste adrese; sesija ostaje HttpOnly kolačić. */
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
};
export default config;
