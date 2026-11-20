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
  await dialog.getByPlaceholder("Description (optional)").fill("Before the 30th");

  await page.reload();
  await expect(dialog.getByPlaceholder("Add a task…")).toHaveValue("Book dentist");
  await expect(dialog.getByPlaceholder("Description (optional)")).toHaveValue("Before the 30th");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Add item to Home" }).click();
  await expect(dialog.getByPlaceholder("Add a task…")).toHaveValue("");
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
