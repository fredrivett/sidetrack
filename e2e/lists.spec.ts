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

test("shows a long list's rows as it scrolls", async ({ page, user }) => {
  user.addList(
    "Inbox",
    Array.from({ length: 100 }, (_, i) => `Task ${i + 1}`),
  );
  await page.goto("/board");
  const first = page.getByRole("button", { name: "Task 1", exact: true });
  const last = page.getByRole("button", { name: "Task 100", exact: true });
  await expect(first).toBeVisible();
  // Only the rows near the view are rendered, but each says where it is in the whole list.
  await expect(last).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ has: first })).toHaveAttribute(
    "aria-setsize",
    "100",
  );
  await first.hover();
  await expect(async () => {
    await page.mouse.wheel(0, 4000);
    await expect(last).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(page.getByRole("listitem").filter({ has: last })).toHaveAttribute(
    "aria-posinset",
    "100",
  );
});

test("moves through a long list with the keys and reorders it by dragging", async ({
  page,
  user,
}) => {
  user.addList(
    "Inbox",
    Array.from({ length: 100 }, (_, i) => `Task ${i + 1}`),
  );
  const dialog = page.getByRole("dialog");
  // The server's page shows the rows before the keys work: select the first
  // one (up stays on it) and open it, until that works.
  const selectFirst = async () => {
    await expect(async () => {
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Task 1" })).toBeVisible({ timeout: 500 });
    }).toPass();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  };
  await page.goto("/board");
  // The pointer rests on the list, where the wheel scrolls it; it doesn't
  // move again, which would hand the keys to the row under it.
  await page.getByRole("button", { name: "Task 1", exact: true }).hover();
  await selectFirst();

  // Down the list, past the rows rendered at first, and open the one reached.
  await expect(page.getByRole("button", { name: "Task 30", exact: true })).toHaveCount(0);
  for (let i = 0; i < 29; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Task 30" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Scrolled far from it, the keys still go on from the selected row.
  await page.mouse.wheel(0, 3000);
  await expect(page.getByRole("button", { name: "Task 30", exact: true })).not.toBeInViewport();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Task 31" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Pick up Task 35 from the keyboard and drop it 3 rows further down.
  const row = (title: string) =>
    page.getByRole("listitem").filter({
      has: page.getByRole("button", { name: title, exact: true }),
    });
  await row("Task 35")
    .getByRole("button")
    .filter({ has: page.getByRole("button", { name: "Task 35", exact: true }) })
    .focus();
  await page.keyboard.press("Space");
  // dnd-kit moves the row on from where the rows are drawn, so a key
  // pressed while they slide aside goes to the same spot: wait for each
  // step to land, the slot lower in the list and the rows still.
  const list = page.getByRole("list");
  const slot = list.getByRole("button", { pressed: true });
  const depth = async () => {
    const [s, l] = await Promise.all([slot.boundingBox(), list.boundingBox()]);
    const still = await list.evaluate((el) => el.getAnimations({ subtree: true }).length === 0);
    return still && s && l ? s.y - l.y : Number.NaN;
  };
  for (let i = 0; i < 3; i++) {
    let before = Number.NaN;
    await expect.poll(async () => (before = await depth()), { intervals: [20] }).not.toBeNaN();
    await page.keyboard.press("ArrowDown");
    await expect.poll(depth, { intervals: [20] }).toBeGreaterThan(before);
  }
  await page.keyboard.press("Space");
  await expect(row("Task 35")).toHaveAttribute("aria-posinset", "38");

  // Saved: after a reload it's still there, reached from the keys again.
  await page.reload();
  await selectFirst();
  for (let i = 0; i < 34; i++) await page.keyboard.press("ArrowDown");
  await expect(row("Task 35")).toHaveAttribute("aria-posinset", "38");
  await expect(row("Task 36")).toHaveAttribute("aria-posinset", "35");
});

test("switches between the Brief and the board, with Done in the account menu", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/brief$/);
  const filter = page.getByRole("button", { name: "Filter" });
  await expect(filter).toHaveCount(0);
  const views = page.getByRole("group", { name: "View" });
  await views.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/board/);
  await expect(page.getByRole("button", { name: "Water plants", exact: true })).toBeVisible();
  await expect(filter).toBeVisible();
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Done items" }).click();
  await expect(page).toHaveURL(/\/done/);
  await expect(page.getByRole("heading", { name: "Done items" })).toBeVisible();
  await expect(filter).toHaveCount(0);
  await page.getByRole("button", { name: "Back to board" }).click();
  await expect(page).toHaveURL(/\/board/);
});

test("drags a list along its tray, and into a Space once confirmed", async ({ page, user }) => {
  user.addList("Home", ["Water plants"]);
  user.addList("Garden", ["Plant jasmine"]);
  user.addSpace("Work");
  await page.goto("/board");
  // The lists on a tray, by name, in order.
  const listsIn = (tray: string) =>
    page
      .getByRole("region", { name: tray })
      .getByRole("button", { name: /^Add item to / })
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")?.slice("Add item to ".length)));
  // Retried as a whole: the board can reload under it (a time zone save).
  const expectLists = (tray: string, names: string[]) =>
    expect(async () => expect(await listsIn(tray)).toEqual(names)).toPass();
  const box = async (name: string) => {
    const b = await page.getByRole("button", { name: `Add item to ${name}` }).boundingBox();
    if (!b) throw new Error(`no list ${name}`);
    return b;
  };
  // Picked up by its header's blank space, left of the buttons.
  const drag = async (name: string, to: { x: number; y: number }) => {
    const add = await box(name);
    const from = { x: add.x - 60, y: add.y + add.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y, { steps: 2 });
    await page.mouse.move(to.x, to.y, { steps: 15 });
    await page.mouse.up();
  };
  await expectLists("Personal", ["Home", "Garden"]);

  // Along its tray it moves without asking.
  const home = await box("Home");
  await drag("Garden", { x: home.x - 200, y: home.y });
  await expectLists("Personal", ["Garden", "Home"]);

  // Onto Work's tray it asks first; Cancel puts it back.
  const work = await page.getByRole("region", { name: "Work" }).boundingBox();
  const intoWork = { x: (work?.x ?? 0) + (work?.width ?? 0) / 2, y: (work?.y ?? 0) + 60 };
  await drag("Garden", intoWork);
  const dialog = page.getByRole("dialog", { name: "Move to Work" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expectLists("Personal", ["Garden", "Home"]);
  await expectLists("Work", []);

  await drag("Garden", intoWork);
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectLists("Work", ["Garden"]);

  // Saved, not only shown.
  await page.reload();
  await expectLists("Work", ["Garden"]);
  await expectLists("Personal", ["Home"]);
});
