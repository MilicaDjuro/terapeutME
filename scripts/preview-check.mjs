// Provjera izgleda: server na portu 3000 mora već raditi. Snimci se čuvaju u .local/screenshots.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const output = new URL("../.local/screenshots/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto("http://127.0.0.1:3000");
  await page.locator(".home-cards .therapist-card").first().waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("home-desktop.png", output)),
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:3000/therapist/ana-markovic/book");
  await page.getByRole("button", { name: /Individualna seansa/ }).click();
  await page.locator(".calendar-picker").waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("booking-desktop.png", output)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: fileURLToPath(new URL("booking-mobile.png", output)),
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:3000");
  await page.locator(".home-cards .therapist-card").first().waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("home-mobile.png", output)),
    fullPage: true,
  });
  console.log("Saved desktop/mobile screenshots to .local/screenshots.");
} finally {
  await browser.close();
}
