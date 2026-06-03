import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// @ts-expect-error - JS seeder, no types
import { seedDemo, DEMO } from "../../api/scripts/seed-demo.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../../../serva-website/assets/screenshots");

// Desktop window, retina-quality for marketing use.
const VIEWPORT = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
} as const;

// Wait until the page-level "Wird geladen…" placeholder is gone, then let it paint.
async function waitReady(page: Page) {
  await page.waitForLoadState("networkidle");
  await page
    .locator(".overview-loading")
    .waitFor({ state: "detached", timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(500);
}

test.beforeAll(async () => {
  try {
    await seedDemo({ log: () => {} });
  } catch (err) {
    console.warn("[screenshots] seed skipped:", (err as Error).message);
  }
});

async function captureAdmin(page: Page, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const shot = (name: string) =>
    page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });

  // 1. Master login
  await page.goto("/login");
  await page.getByText("Master-Anmeldung").waitFor();
  await shot("01-master-login");

  await page.getByLabel("Benutzername").fill("master");
  await page.getByLabel("Passwort").fill("2009");
  await page.getByRole("button", { name: "Anmelden" }).click();

  // 2. Events list
  await page.waitForURL("**/events");
  await page.getByText(DEMO.eventName).first().waitFor();
  await waitReady(page);
  await shot("02-events");

  // 3. Admin login for the active event
  await page.getByRole("button", { name: "Als Admin anmelden" }).first().click();
  await page.waitForURL("**/admin-login");
  await page.getByLabel("Benutzername").fill(DEMO.adminUsername);
  await page.getByLabel("Passwort").fill(DEMO.adminPassword);
  await page.getByRole("button", { name: "Als Admin anmelden" }).click();

  // Lands on the menu page inside the admin shell
  await page.waitForURL("**/menu");
  await waitReady(page);
  await shot("03-menu");

  // 4. Walk the sidebar and capture the key pages
  const pages: Array<[string, string]> = [
    ["Übersicht", "04-overview"],
    ["Tische", "05-tables"],
    ["Benutzer", "06-users"],
    ["Bestellungen", "07-orders"],
    ["Statistik", "08-statistics"],
  ];

  for (const [label, name] of pages) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await waitReady(page);
    await shot(name);
  }
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ ...VIEWPORT, colorScheme: scheme });
    test(`capture admin screens (${scheme})`, async ({ page }) => {
      await captureAdmin(page, `${ROOT}/${scheme}/admin`);
    });
  });
}
