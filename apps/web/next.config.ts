import type { NextConfig } from "next";
// Podešavanja frontend frameworka. Stranice i poslovna pravila nijesu u ovom fajlu.
const config: NextConfig = {
  // Zajednički paket sadrži TypeScript, pa Next.js treba i njega da kompajlira.
  transpilePackages: ["@terapeut/domain"],
  poweredByHeader: false,
};
export default config;
