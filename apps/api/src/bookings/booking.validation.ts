import { BadRequestException } from "@nestjs/common";
import { addDays, dateKey, isDateKey } from "@terapeut/domain";
import { requireBody, requireText } from "../auth/auth.validation";

/** Čita cijeli broj u dozvoljenom opsegu; ne prihvata prazno polje ili boolean. */
export function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/.test(String(value))
  )
    throw new BadRequestException(`${label} mora biti cijeli broj.`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum)
    throw new BadRequestException(`${label} nije u dozvoljenom opsegu.`);
  return number;
}

/** Zakazivanje i radno vrijeme po datumu ograničava na narednih 90 dana u zoni Europe/Podgorica. */
export function requireBookingDate(value: unknown): string {
  const date = requireText(value, "Datum", 10);
  if (!isDateKey(date) || date < dateKey() || date > addDays(dateKey(), 90))
    throw new BadRequestException("Izaberite datum u narednih 90 dana.");
  return date;
}

/** Provjerava interval jednog dana; kraj 1440 znači ponoć na kraju tog dana. */
export function requireTimeRange(value: unknown) {
  const body = requireBody(value);
  const start = requireInteger(body.start, "Početak", 0, 1439);
  const end = requireInteger(body.end, "Kraj", 1, 1440);
  if (start >= end)
    throw new BadRequestException("Kraj mora biti poslije početka.");
  return { start, end };
}
