import { expect, test } from "./fixtures";

test("moves between settings with the sidebar on desktop", async ({ page, user }) => {
  void user;
  await page.goto("/brief");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("menuitem", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Settings" });
  await expect(nav.getByRole("link", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Spaces" }).click();
  await expect(page).toHaveURL(/\/settings\/spaces$/);
  await expect(page.getByRole("heading", { level: 1, name: "Spaces" })).toBeVisible();
  await expect(page).toHaveTitle("Spaces · Sidetrack");
  await expect(nav.getByRole("link", { name: "Spaces" })).toHaveAttribute("aria-current", "page");
});

test("moves between settings through the Settings page on a phone", async ({ page, user }) => {
  void user;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  // No sidebar on a phone: the index lists every page instead.
  await expect(page.getByRole("navigation", { name: "Settings" })).toBeHidden();
  await page.getByRole("link", { name: /^Profile/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();

  // Back goes to the Settings page, and from there to the board.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("link", { name: "Back to board" }).click();
  await expect(page).toHaveURL(/\/brief$/);
});
