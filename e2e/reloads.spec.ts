import { getDb } from "@/core/db";
import { getItem, listItems } from "@/core/items";
import { getTimeZone, setTimeZone } from "@/core/users";
import type { Route } from "@playwright/test";
import { expect, test } from "./fixtures";

// What an open page does when the server changes under it: another tab's
// edit, a deploy, a reload. See LatestDeploy and useStoredState.

test("shows a change made in another tab without a reload", async ({ page, context, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/board");
  await expect(page.getByRole("button", { name: "Water plants", exact: true })).toBeVisible();
  // Marks this page load: it's gone if the page reloads.
  await page.evaluate(() => Object.assign(window, { e2eMarker: true }));

  const other = await context.newPage();
  await other.goto("/board");
  await other.getByRole("button", { name: "Add item to Home" }).click();
  await other.getByPlaceholder("Add a task…").fill("Refill salt");
  await other.getByRole("button", { name: "Add item" }).click();

  await expect(page.getByRole("button", { name: "Refill salt", exact: true })).toBeVisible();
  expect(await page.evaluate(() => "e2eMarker" in window)).toBe(true);
});

test("keeps New item's draft through a reload, until it's cancelled", async ({ page, user }) => {
  user.addList("Home");
  await page.goto("/board");
  await page.getByRole("button", { name: "Add item to Home" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Add a task…").fill("Book dentist");
  await dialog.getByPlaceholder("Add description…").fill("Before the 30th");
  const due = dialog.getByRole("button", { name: /^Due/ });
  await due.click();
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await expect(due).toHaveText("Due Tomorrow");

  await page.reload();
  await expect(dialog.getByPlaceholder("Add a task…")).toHaveValue("Book dentist");
  await expect(dialog.getByPlaceholder("Add description…")).toHaveValue("Before the 30th");
  await expect(due).toHaveText("Due Tomorrow");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Add item to Home" }).click();
  await expect(dialog.getByPlaceholder("Add a task…")).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Due date" })).toBeVisible();
});

test("after a deploy, keeps what's open and offers to reload", async ({ page, context, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/board");
  await page.getByRole("button", { name: "Add item to Home" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Add a task…").fill("Book dentist");
  await page.evaluate(() => Object.assign(window, { e2eMarker: true }));

  // The server is now on a newer deploy...
  await page.route("/api/version", (route) => route.fulfill({ body: "a-newer-deploy" }));
  // ...and something changes, so the page wants fresh data.
  const other = await context.newPage();
  await other.goto("/board");
  await other.getByRole("button", { name: "Water plants", exact: true }).click({ button: "right" });
  await other.getByRole("menuitem", { name: "Delete item" }).click();
  await other.getByRole("menuitem", { name: "Confirm delete?" }).click();
  await other.close();

  const toast = page.getByText("Sidetrack has been updated");
  await expect(toast).toBeVisible();
  await expect(dialog.getByPlaceholder("Add a task…")).toHaveValue("Book dentist");
  expect(await page.evaluate(() => "e2eMarker" in window)).toBe(true);

  // Leaving the tab with nothing open moves it onto the new deploy.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  const reloaded = page.waitForEvent("load");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await reloaded;
  expect(await page.evaluate(() => "e2eMarker" in window)).toBe(false);
});

test("saves a new time zone without reloading what's being opened", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  // Last seen somewhere else: the board saves the browser's zone on load.
  setTimeZone(getDb().db, user.id, "America/New_York");
  await page.goto("/board");
  await page.evaluate(() => Object.assign(window, { e2eMarker: true }));
  // At once, while the save is in flight.
  await page.getByRole("button", { name: "Water plants", exact: true }).click();
  // ...and carry on in it: a reload would take the dialog away mid-edit.
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Water plants" }).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Water the ferns");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Water the ferns" })).toBeVisible();
  await expect.poll(() => getTimeZone(getDb().db, user.id)).toBe("Europe/London");
  expect(await page.evaluate(() => "e2eMarker" in window)).toBe(true);
});

test("reopens the item that was open after a reload, until it's closed", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/board");
  await page.getByRole("button", { name: "Water plants", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Water plants" })).toBeVisible();

  await page.reload();
  await expect(dialog.getByRole("button", { name: "Water plants" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Water plants", exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("keeps a comment being written through a reload, until it's posted", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/board");
  await page.getByRole("button", { name: "Water plants", exact: true }).click();
  // A combobox: typing @ suggests people.
  const comment = page.getByRole("combobox", { name: "Add a comment" });
  await comment.fill("Twice a week in summer");

  await page.reload();
  await expect(comment).toHaveValue("Twice a week in summer");
  await page.getByRole("button", { name: /^Comment/ }).click();
  await expect(page.getByRole("dialog").getByText("Twice a week in summer")).toBeVisible();
  await expect(comment).toHaveValue("");
  await page.reload();
  await expect(comment).toHaveValue("");
});

test("picks an unsaved edit back up after a reload, and keeps it when the save fails", async ({ page, user }) => {
  const list = user.addList("Home", ["Water plants"]);
  const [item] = listItems(getDb().db, user.id, list.id);
  await page.goto("/board");
  await page.getByRole("button", { name: "Water plants", exact: true }).click();
  // Saving this text fails until unrouted, so a save that starts as the
  // page unloads (the field losing focus) can't land either.
  const failSaves = (route: Route) =>
    route.request().postData()?.includes("The ferns") ? route.fulfill({ status: 500 }) : route.fallback();
  await page.route("**/board**", failSaves);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add description…" }).click();
  await page.keyboard.type("The ferns by the window");

  // Reloaded mid-edit: still editing, with the text.
  await page.reload();
  const field = dialog.getByRole("textbox").and(dialog.getByPlaceholder("Add description…"));
  await expect(field).toHaveValue("The ferns by the window");

  // The save fails: the draft stays for the next load.
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText(/Couldn't save the description/)).toBeVisible();
  await page.unroute("**/board**", failSaves);
  await page.reload();
  await expect(field).toHaveValue("The ferns by the window");

  // Saved: shown, and gone from the drafts.
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(dialog.getByText("The ferns by the window")).toBeVisible();
  // Once it's saved, not just shown: a reload before then keeps the draft.
  await expect.poll(() => getItem(getDb().db, user.id, item.id)?.description).toBe("The ferns by the window");
  await page.reload();
  await expect(dialog.getByText("The ferns by the window")).toBeVisible();
  await expect(field).toBeHidden();
});
