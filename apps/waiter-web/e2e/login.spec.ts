import { expect, test } from "@playwright/test";

test("login page renders the waiter form", async ({ page }) => {
  await page.goto("/waiter/login");

  await expect(page.getByRole("heading", { name: "BstöMa" })).toBeVisible();
  await expect(page.getByLabel("Benutzername")).toBeVisible();
  await expect(page.getByLabel("Event-Passcode")).toBeVisible();
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
});
