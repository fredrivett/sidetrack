import { createAdmin, expect, test } from "./fixtures";

test("only an admin sees everyone's usage", async ({ page, user, browser, baseURL }) => {
  user.addList("Home", ["Water plants", "Fix the gate"]);

  // Anyone else finds nothing there.
  await page.goto("/admin");
  await expect(page.getByText("Page not found")).toBeVisible();

  const admin = await createAdmin();
  const context = await browser.newContext();
  await admin.signIn(context, baseURL ?? "");
  const adminPage = await context.newPage();
  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
  // The new list and its two items, all today.
  const row = adminPage.getByRole("row").filter({ hasText: `@${user.username}` });
  await expect(row.getByText("3 changes")).toBeVisible();
  await expect(row.getByRole("img", { name: "3 changes on 1 of the last 90 days" })).toBeVisible();
  await context.close();
});
