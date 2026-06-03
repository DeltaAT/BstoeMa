import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// @ts-expect-error - JS seeder, no types
import { seedDemo, DEMO } from "../../api/scripts/seed-demo.mjs";

// Screenshots land in the (sibling) marketing-site repo, split by color scheme.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../../../serva-website/assets/screenshots");

// Phone viewport (iPhone 14-ish) so the PWA looks right on the website.
const VIEWPORT = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
} as const;

test.beforeAll(async () => {
  // Idempotent — safe even if data is already there.
  try {
    await seedDemo({ log: () => {} });
  } catch (err) {
    console.warn("[screenshots] seed skipped:", (err as Error).message);
  }
});

async function captureWaiter(page: Page, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const shot = (name: string) =>
    page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });

  // 1. Login screen (empty form)
  await page.goto("/waiter/login");
  await page.getByRole("heading", { name: "Serva" }).waitFor();
  await shot("01-login");

  // Log in as a waiter
  await page.getByLabel("Benutzername").fill(DEMO.waiter);
  await page.getByLabel("Event-Passcode").fill(DEMO.eventPasscode);
  await page.getByRole("button", { name: "Anmelden" }).click();

  // 2. Tables grid
  await page.waitForURL("**/waiter/tables");
  await page.getByRole("listitem").first().waitFor();
  await shot("02-tables");

  // 3. Menu for the first table
  await page.getByRole("listitem").first().click();
  await page.waitForURL("**/menu");
  await page.locator(".menu-row").first().waitFor();
  await shot("03-menu");

  // Add a few items so the cart CTA appears
  const plusButtons = page.locator(".stepper__btn--add");
  await plusButtons.nth(0).click();
  await plusButtons.nth(0).click();
  await plusButtons.nth(1).click();
  await shot("04-menu-with-cart");

  // 4. Order / cart review screen
  await page.locator(".next-cta").click();
  await page.waitForURL("**/order");
  await page.waitForLoadState("networkidle");
  await shot("05-order");

  // 5. Orders list
  await page.goto("/waiter/orders");
  await page.waitForLoadState("networkidle");
  await shot("06-orders");
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ ...VIEWPORT, colorScheme: scheme });
    test(`capture waiter screens (${scheme})`, async ({ page }) => {
      await captureWaiter(page, `${ROOT}/${scheme}/waiter`);
    });
  });
}
