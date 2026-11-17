"use client";
import { Clock3 } from "lucide-react";
import { useDemo } from "@/lib/demo-context";

/** Bira sat i svaki pojedinačni minut u 24-časovnom formatu, bez ograničenja na 15 minuta. */
export function TimeField({
  name,
  label,
  defaultValue = "09:00",
  disabled = false,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  disabled?: boolean;
}) {
  const { translate } = useDemo();
  const [hour, minute] = defaultValue.split(":");
  const hours: string[] = [];
  const minutes: string[] = [];
  for (let value = 0; value < 24; value += 1)
    hours.push(String(value).padStart(2, "0"));
  for (let value = 0; value < 60; value += 1)
    minutes.push(String(value).padStart(2, "0"));
  // Obični select elementi rade tastaturom i na telefonu; form.reset vraća početne sate.
  return (
    <fieldset className="time-field" disabled={disabled}>
      <legend>{label}</legend>
      <div className="time-field-controls">
        <Clock3 size={18} aria-hidden="true" />
        <select
          name={`${name}-hour`}
          aria-label={`${label} — ${translate("sat", "hour")}`}
          defaultValue={hour}
          required
        >
          {hours.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span aria-hidden="true">:</span>
        <select
          name={`${name}-minute`}
          aria-label={`${label} — ${translate("minut", "minute")}`}
          defaultValue={minute}
          required
        >
          {minutes.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

/** Spaja izabrani sat i minut; API i dalje prima minute i ponovo provjerava interval. */
export function readTimeField(values: FormData, name: string): string {
  return `${String(values.get(`${name}-hour`) ?? "")}:${String(values.get(`${name}-minute`) ?? "")}`;
}
