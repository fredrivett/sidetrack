import type { Page } from "@playwright/test";
import { getDb } from "@/core/db";
import { listItems } from "@/core/items";
import { addLabel } from "@/core/labels";
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

test("adds an item with a checklist ticked and set up before it's added", async ({ page, user }) => {
  const home = user.addList("Home");
  // A line's #word sets a label the list already has.
  addLabel(getDb().db, user.id, home.id, { name: "tech" }, "web");
  await page.goto("/board");
  await page.getByRole("button", { name: "Add item to Home" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Add a task…").fill("Pack for the trip");
  const step = dialog.getByRole("textbox", { name: "Add a sub-item" });
  for (const line of ["Toothbrush", "Charger #tech"]) {
    await step.fill(line);
    await step.press("Enter");
  }
  await dialog.getByRole("checkbox", { name: "Complete Toothbrush" }).check();
  // Opened, a line gets a date of its own.
  await dialog.getByRole("button", { name: /^Charger/ }).click();
  await dialog.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await dialog.getByRole("button", { name: "Back to Pack for the trip" }).click();
  await dialog.getByRole("button", { name: "Add item" }).click();
  await expect(dialog).toBeHidden();

  // Saved, each line with what was set on it.
  const all = listItems(getDb().db, user.id, home.id, { includeCompleted: true });
  const by = (title: string) => all.find((i) => i.title === title);
  expect(by("Pack for the trip")?.completedAt).toBeNull();
  expect(by("Toothbrush")?.completedAt).not.toBeNull();
  expect(by("Charger")).toMatchObject({ labels: ["tech"], completedAt: null });
  expect(by("Charger")?.dueDate).not.toBeNull();
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

test("an item's pinned fields never hide its checklist", async ({ page, user }) => {
  const home = user.addList("Home");
  const steps = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}`);
  user.addItem(home.id, "Spring clean", [], undefined, steps);
  // Whether the user sees it: what's at its middle is it, not the header.
  const uncovered = (target: ReturnType<Page["locator"]>) =>
    target.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    });
  await page.goto("/board");
  await row(page, "Spring clean").click();
  const dialog = page.getByRole("dialog", { name: "Spring clean" });
  const first = dialog.getByRole("checkbox", { name: "Complete Step 1", exact: true });
  const last = dialog.getByRole("checkbox", { name: "Complete Step 30" });

  // Scrolled down, focus back on the first step stops below the header.
  await last.focus();
  await expect(first).not.toBeInViewport();
  await first.focus();
  expect(await uncovered(first)).toBe(true);
  // And editing the title where it's pinned leaves the checklist where it is.
  await last.focus();
  await dialog.getByRole("button", { name: "Spring clean", exact: true }).click();
  await expect(dialog.getByRole("textbox").first()).toBeFocused();
  expect(await uncovered(last)).toBe(true);
  await page.keyboard.press("Enter");

  // A description too long to pin doesn't cover the steps either: it scrolls away.
  await dialog.getByRole("button", { name: "Add description…" }).click();
  await page.keyboard.type(Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n\n"));
  await page.keyboard.press("ControlOrMeta+Enter");
  await last.focus();
  expect(await uncovered(last)).toBe(true);
  await first.focus();
  expect(await uncovered(first)).toBe(true);
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
