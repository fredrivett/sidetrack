import { expect, test } from "./fixtures";

test("signs in with email and password, and out again", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.context().clearCookies();
  await page.goto("/board");
  await expect(page).toHaveURL(/\/login\?next=%2Fboard$/);
  await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Back where they were headed.
  await expect(page.getByRole("button", { name: "Water plants", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/board/);

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/(login|welcome)?$|\/login/);
  await page.goto("/board");
  await expect(page).toHaveURL(/\/login/);
});

test("turns away a wrong password", async ({ page, user }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
