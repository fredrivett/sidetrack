import { createAdmin, expect, test } from "./fixtures";

test("only an admin sees everyone's usage", async ({ page, user, browser, baseURL }) => {
  user.addList("Home", ["Water plants", "Fix the gate"]);

  // Anyone else has no link to it, and finds nothing there.
  await page.goto("/");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Usage" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByText("Page not found")).toBeVisible();

  // The admin gets there from the account menu.
  const admin = await createAdmin();
  const context = await browser.newContext();
  await admin.signIn(context, baseURL ?? "");
  const adminPage = await context.newPage();
  await adminPage.goto("/");
  await adminPage.getByRole("button", { name: "Account", exact: true }).click();
  await adminPage.getByRole("menuitem", { name: "Usage" }).click();
  await expect(adminPage).toHaveURL(/\/admin$/);
  await expect(adminPage.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
  // The new list and its two items, all today.
  const row = adminPage.getByRole("row").filter({ hasText: `@${user.username}` });
  await expect(row.getByText("3 changes")).toBeVisible();
  await expect(row.getByRole("img", { name: "3 changes on 1 of the last 90 days" })).toBeVisible();
  await context.close();
});
