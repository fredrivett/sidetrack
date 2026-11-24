import type { Page } from "@playwright/test";
import { getDb } from "@/core/db";
import { listItems } from "@/core/items";
import { getProject } from "@/core/projects";
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

test("reorders a checklist from the Brief and from the item's dialog", async ({ page, user }) => {
  const home = user.addList("Home");
  user.addItem(home.id, "Spring clean", [], undefined, ["Windows", "Oven", "Garage"]);
  // dnd-kit moves the row on from where the rows are measured, so each key
  // waits for the drag to say where the row is now (from the moment it's
  // picked up), and for the rows to be still: the card lifting, rows
  // sliding aside.
  const announced = async (text: string) => {
    await expect(page.getByText(text, { exact: true })).toBeAttached();
    await expect
      .poll(
        () =>
          page.evaluate(
            // Not the page's endless ones, such as a loading pulse.
            () =>
              document
                .getAnimations()
                .filter((a) => a.effect?.getTiming().iterations !== Infinity).length,
          ),
        { intervals: [20] },
      )
      .toBe(0);
  };

  // On the Brief, Garage goes up one, from the keyboard.
  await page.goto("/brief");
  const steps = page.locator("[data-parent-id]");
  await expect(steps).toHaveText(["Windows", "Oven", "Garage"]);
  await steps.filter({ has: row(page, "Garage") }).focus();
  await page.keyboard.press("Space");
  await announced("“Garage” is step 3 of 3.");
  await page.keyboard.press("ArrowUp");
  await announced("“Garage” is step 2 of 3.");
  await page.keyboard.press("Space");
  await expect(steps).toHaveText(["Windows", "Garage", "Oven"]);

  // In the dialog, Windows goes to the end; Escape on the way only puts it back.
  // The greeting can name it too: open it from its row.
  await page.locator("[data-item-row]").getByRole("button", { name: "Spring clean", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Spring clean" });
  const lines = dialog.getByRole("button", { name: /^Reorder / });
  await expect(lines).toHaveText(["Windows", "Garage", "Oven"]);
  await dialog.getByRole("button", { name: "Reorder Windows" }).focus();
  await page.keyboard.press("Space");
  await announced("“Windows” is step 1 of 3.");
  await page.keyboard.press("Escape");
  await announced("Put “Windows” back.");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Space");
  await announced("“Windows” is step 1 of 3.");
  await page.keyboard.press("ArrowDown");
  await announced("“Windows” is step 2 of 3.");
  await page.keyboard.press("ArrowDown");
  await announced("“Windows” is step 3 of 3.");
  await page.keyboard.press("Space");
  await expect(lines).toHaveText(["Garage", "Oven", "Windows"]);

  // Saved, not only shown.
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(steps).toHaveText(["Garage", "Oven", "Windows"]);
});

test("cancels an item with its replacement, and reopens it", async ({ page, user }) => {
  const home = user.addList("Home", ["Water plants", "Water the garden"]);
  const { db } = getDb();
  const [, garden] = listItems(db, user.id, home.id);
  const prefix = getProject(db, user.id, home.id)?.prefix;
  await page.goto("/board");
  await row(page, "Water plants").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel…" }).click();
  const cancel = page.getByRole("dialog", { name: /Cancel “Water plants”/ });
  // Opens ready to type the reason.
  await expect(cancel.getByLabel("Why (optional)")).toBeFocused();
  await cancel.getByLabel("Why (optional)").fill("Doing the whole garden");
  await cancel.getByLabel("Replaced by (optional)").fill(`${prefix}-${garden.number}`);
  await cancel.getByRole("button", { name: "Cancel item" }).click();
  await expect(cancel).toBeHidden();
  await page.keyboard.press("Escape");

  // Saved: after a reload it's still cancelled, naming its replacement.
  await page.reload();
  const cancelled = page.locator("[data-item-row]").filter({ hasText: "Water plants" });
  await expect(cancelled.getByText("Cancelled")).toBeVisible();
  await expect(cancelled.getByText(`${prefix}-${garden.number}`)).toBeVisible();
  const reopen = cancelled.getByRole("checkbox", { name: "Reopen" });
  await reopen.uncheck();
  await expect(cancelled.getByRole("checkbox", { name: "Complete" })).not.toBeChecked();
  await expect(cancelled.getByText("Cancelled")).toBeHidden();
});

test("Shift-clicking an item's circle opens Cancel, without ticking it", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/board");
  const item = page.locator("[data-item-row]").filter({ has: row(page, "Water plants") });
  const circle = item.getByRole("checkbox", { name: "Complete" });
  await circle.click({ modifiers: ["Shift"] });
  const cancel = page.getByRole("dialog", { name: /Cancel “Water plants”/ });
  await expect(cancel).toBeVisible();
  await cancel.getByRole("button", { name: "Keep it open" }).click();
  await expect(cancel).toBeHidden();
  await page.reload();
  await expect(circle).not.toBeChecked();
});

test("⇧X opens Cancel for the hovered item, and X still ticks it", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/board");
  const cancel = page.getByRole("dialog", { name: /Cancel “Water plants”/ });
  // The server's page shows the rows before the keys work: hover anew (a
  // hover from before then isn't counted) and press, until it opens.
  await expect(async () => {
    await page.mouse.move(0, 0);
    await row(page, "Water plants").hover();
    await page.keyboard.press("Shift+X");
    await expect(cancel).toBeVisible({ timeout: 500 });
  }).toPass();
  await cancel.getByRole("button", { name: "Cancel item" }).click();
  await expect(cancel).toBeHidden();
  const item = page.locator("[data-item-row]").filter({ hasText: "Water plants" });
  await expect(item.getByText("Cancelled")).toBeVisible();
  await item.hover();
  await page.keyboard.press("x");
  await expect(item.getByRole("checkbox", { name: "Complete" })).not.toBeChecked();
  await expect(item.getByText("Cancelled")).toBeHidden();
});

test("sends an item to Someday, under Later, and a date brings it back", async ({ page, user }) => {
  user.addList("Home", ["Water plants", "Redo the garden"]);
  await page.goto("/board");
  await row(page, "Redo the garden").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Due date" }).hover();
  await page.getByRole("menuitem", { name: "Someday" }).click();
  const later = page.getByRole("button", { name: /^Later/ });
  await expect(later).toHaveText("Later1");
  // Folded away: no row by that name at all, badge or not.
  await expect(page.getByRole("button", { name: /^Redo the garden/ })).toHaveCount(0);
  await expect(row(page, "Water plants")).toBeVisible();

  // Saved: still folded under Later after a reload, and there when unfolded,
  // its name carrying the Someday badge.
  await page.reload();
  await later.click();
  const someday = row(page, "Redo the garden Someday");
  await expect(someday).toBeVisible();

  await someday.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Someday" }).click();
  await dialog.getByRole("button", { name: "Tomorrow" }).click();
  await page.keyboard.press("Escape");
  await expect(later).toBeHidden();
  await page.reload();
  // Back in the list, its name now carrying the date.
  await expect(page.getByRole("button", { name: "Redo the garden Tomorrow", exact: true })).toBeVisible();
  await expect(later).toBeHidden();
});
