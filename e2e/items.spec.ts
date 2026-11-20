import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** An item's title on the board, which opens it. */
const row = (page: Page, title: string) =>
  page.getByRole("button", { name: title, exact: true });

test("adds an item to a list", async ({ page, user }) => {
  user.addList("Home");
  await page.goto("/board");
  await page.getByRole("button", { name: "Add item to Home" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Add a task…").fill("Water plants");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "Water plants")).toBeVisible();
  // Saved, not only shown.
  await page.reload();
  await expect(row(page, "Water plants")).toBeVisible();
});

test("completes an item, and it stays completed", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/board");
  const complete = page
    .locator("[data-item-row]")
    .filter({ has: row(page, "Water plants") })
    .getByRole("checkbox", { name: "Complete" });
  await complete.check();
  await expect(complete).toBeChecked();
  await page.reload();
  await expect(complete).toBeChecked();
});

test("renames an item from its dialog", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/board");
  await row(page, "Water plants").click();
  const dialog = page.getByRole("dialog");
  // The title turns into a field where it is.
  await dialog.getByRole("button", { name: "Water plants" }).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Water the ferns");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(row(page, "Water the ferns")).toBeVisible();
  await page.reload();
  await expect(row(page, "Water the ferns")).toBeVisible();
});

test("deletes an item from its right-click menu", async ({ page, user }) => {
  user.addList("Home", ["Water plants", "Refill salt"]);
  await page.goto("/board");
  await row(page, "Water plants").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete item" }).click();
  await page.getByRole("menuitem", { name: "Confirm delete?" }).click();
  await expect(row(page, "Water plants")).toBeHidden();
  await page.reload();
  await expect(row(page, "Refill salt")).toBeVisible();
  await expect(row(page, "Water plants")).toBeHidden();
});
