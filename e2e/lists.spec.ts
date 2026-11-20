import { expect, test } from "./fixtures";

test("creates a list", async ({ page, user }) => {
  user.addList("Home");
  await page.goto("/board");
  await page.getByRole("button", { name: "Add list" }).click();
  const dialog = page.getByRole("dialog", { name: "New list" });
  await dialog.getByPlaceholder("List name, e.g. Home or Buy").fill("Garden");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Add item to Garden" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Add item to Garden" })).toBeVisible();
});

test("switches between the Brief, the board and Done", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/brief$/);
  const views = page.getByRole("group", { name: "View" });
  await views.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/board/);
  await expect(page.getByRole("button", { name: "Water plants", exact: true })).toBeVisible();
  await views.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/done/);
  await expect(views.getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
});
