import type { Page } from "@playwright/test";
import { getDb } from "@/core/db";
import { listItems } from "@/core/items";
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

test("adds what an agent read off a photo, after review", async ({ page, user }) => {
  const home = user.addList("Home", ["Water plants"]);
  const [water] = listItems(getDb().db, user.id, home.id);
  user.addPhoto([
    { title: "Water plants", projectId: home.id, matchItemId: water.id, done: true },
    { title: "Descale coffee machine", projectId: home.id },
    { title: "Plant jasmine", projectId: home.id },
  ]);
  await page.goto("/board");
  // The board notes the list in view (?p=) with replaceState, which cancels
  // a link followed at the same moment; wait for it.
  await expect(page).toHaveURL(/[?&]p=/);
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Add these to Sidetrack" })).toBeVisible();
  await page.getByRole("button", { name: "Leave out “Plant jasmine”" }).click();
  await page.getByRole("button", { name: "Add 1, tick off 1" }).click();
  await expect(page.getByRole("heading", { name: "Add these to Sidetrack" })).toBeHidden();
  // Saved, not only shown.
  await page.goto("/board");
  await expect(row(page, "Descale coffee machine")).toBeVisible();
  await expect(row(page, "Plant jasmine")).toBeHidden();
  await expect(
    page
      .locator("[data-item-row]")
      .filter({ has: row(page, "Water plants") })
      .getByRole("checkbox", { name: "Complete" }),
  ).toBeChecked();
  // The item keeps the photo it came from.
  await row(page, "Descale coffee machine").click();
  await expect(page.getByRole("dialog").getByText(/^From a photo/)).toBeVisible();
});
