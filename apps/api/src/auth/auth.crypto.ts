import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

/** Računa spor scrypt hash; parametri traže oko 128 MiB memorije po pokušaju. */
export function derivePassword(
  password: string,
  salt: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
  });
}

/** Čuva format i nasumičnu so uz hash; nikada ne čuva izvornu lozinku. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await derivePassword(password, salt);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

/** Poredi lozinku sa hashom u konstantnom vremenu; nepoznat nalog takođe računa scrypt. */
export async function verifyPassword(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  const parts = storedHash?.split("$");
  const valid =
    parts?.length === 3 &&
    parts[0] === "scrypt" &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{128}$/.test(parts[2]);
  const derived = await derivePassword(
    password,
    valid ? parts[1] : "00000000000000000000000000000000",
  );
  if (!valid) return false;
  return timingSafeEqual(derived, Buffer.from(parts[2], "hex"));
}

/** Hashuje token sesije; ne omogućava korišćenje hasha kao browser tokena. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Tajnim serverskim ključem štiti kratke kodove i ključeve ograničenja pokušaja. */
export function privateHash(value: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET!)
    .update(value)
    .digest("hex");
}

/** Poredi dva unaprijed generisana heksadecimalna hasha bez ranog prekida. */
export function matchesHash(expected: string, actual: string): boolean {
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(actual, "hex"),
  );
}
