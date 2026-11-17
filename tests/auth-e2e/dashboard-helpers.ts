import { expect, type Locator, type Page } from "@playwright/test";

/** Otvara samo zatvorene sekcije, kao korisnik koji želi da uređuje raspored. */
export async function openScheduleSections(page: Page) {
  const sections = page.locator(".schedule-section");
  await expect(sections).toHaveCount(3);
  for (const section of await sections.all()) {
    if (
      !(await section.evaluate(
        (element) => (element as HTMLDetailsElement).open,
      ))
    )
      await section.locator("summary").click();
  }
}

/** Bira stvarne padajuće liste sata i minuta; ne mijenja skrivena polja ni React stanje. */
export async function chooseTime(
  container: Locator,
  label: string,
  time: string,
) {
  const [hour, minute] = time.split(":");
  await container
    .getByRole("combobox", { name: `${label} — sat`, exact: true })
    .selectOption(hour);
  await container
    .getByRole("combobox", { name: `${label} — minut`, exact: true })
    .selectOption(minute);
}
