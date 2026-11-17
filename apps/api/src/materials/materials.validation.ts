import { BadRequestException } from "@nestjs/common";
import { isUtf8 } from "node:buffer";
import { isDateKey } from "@terapeut/domain";
import { requireBody, requireText } from "../auth/auth.validation";

export interface MaterialUpload {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/** Provjerava naslov, vrstu, uputstvo i opcioni rok/link; sadržaj ostaje običan tekst. */
export function validateMaterial(value: unknown) {
  const body = requireBody(value);
  const title = requireText(body.title, "Naslov", 160);
  const kind = requireText(body.kind, "Vrsta materijala", 20);
  if (!["HOMEWORK", "EXERCISE", "JOURNAL", "RESOURCE"].includes(kind))
    throw new BadRequestException("Izaberite vrstu materijala.");
  if (typeof body.instructions !== "string" || body.instructions.length > 10000)
    throw new BadRequestException("Uputstvo može imati najviše 10000 znakova.");
  const instructions = body.instructions.trim();
  let resourceUrl: string | null = null;
  if (body.resourceUrl !== undefined && body.resourceUrl !== "") {
    const text = requireText(body.resourceUrl, "Link", 2000);
    try {
      const url = new URL(text);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("Unsupported URL");
      resourceUrl = url.toString();
      if (resourceUrl.length > 2000) throw new Error("URL too long");
    } catch {
      throw new BadRequestException(
        "Unesite ispravan http ili https link, bez korisničkog imena i lozinke.",
      );
    }
  }
  let dueDate: string | null = null;
  if (body.dueDate !== undefined && body.dueDate !== "") {
    dueDate = requireText(body.dueDate, "Rok", 10);
    if (!isDateKey(dueDate))
      throw new BadRequestException("Rok mora biti ispravan datum.");
  }
  if (
    body.removeFile !== undefined &&
    !["true", "false"].includes(String(body.removeFile))
  )
    throw new BadRequestException("Izbor uklanjanja priloga nije ispravan.");
  return {
    title,
    kind,
    instructions,
    resourceUrl,
    dueDate,
    removeFile: body.removeFile === "true",
  };
}

/** Provjerava veličinu i osnovne PDF oznake; preuzimanje je uvijek prilog, bez javnog prikaza. */
export function validateMaterialFile(file: MaterialUpload | undefined) {
  if (!file) return null;
  if (
    !file.buffer?.length ||
    file.size !== file.buffer.length ||
    file.size > 5 * 1024 * 1024
  )
    throw new BadRequestException("PDF dokument može imati najviše 5 MB.");
  if (
    !/^%PDF-\d\.\d/.test(file.buffer.subarray(0, 8).toString("ascii")) ||
    !file.buffer.subarray(-1024).includes(Buffer.from("%%EOF"))
  )
    throw new BadRequestException(
      "Prilog mora biti PDF dokument. Promjena nastavka naziva nije dovoljna.",
    );
  // Čuvamo samo naziv, nikada putanju, kontrolne znakove ili korisnički Content-Type.
  // Multipart može prenijeti UTF-8 naziv kao latin1; dekodiramo samo kada nema gubitka bajtova.
  const nameBytes = Buffer.from(file.originalname, "latin1");
  let originalName = file.originalname;
  if (nameBytes.toString("latin1") === originalName && isUtf8(nameBytes))
    originalName = nameBytes.toString("utf8");
  const name = originalName
    .replaceAll("\\", "/")
    .split("/")
    .pop()!
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  if (!name || name.length > 180 || !name.toLowerCase().endsWith(".pdf"))
    throw new BadRequestException(
      "Naziv PDF dokumenta može imati najviše 180 znakova i mora završavati sa .pdf.",
    );
  return { name, data: file.buffer, size: file.buffer.length };
}
