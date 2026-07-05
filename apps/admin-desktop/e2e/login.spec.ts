import { expect, test } from "@playwright/test";

test("master login page renders", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "BstöMa" })).toBeVisible();
  await expect(page.getByText("Master-Anmeldung")).toBeVisible();
  await expect(page.getByLabel("Benutzername")).toBeVisible();
  await expect(page.getByLabel("Passwort")).toBeVisible();
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
});
