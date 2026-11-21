import { createPerson, expect, test } from "./fixtures";

test("shares a list as view only", async ({ page, user }) => {
  user.addList("Groceries", ["Buy milk"]);
  const jo = await createPerson();
  await page.goto("/board");
  await page.getByRole("button", { name: "List options" }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = page.getByRole("dialog", { name: "Share “Groceries”" });
  await dialog.getByPlaceholder("username or email").fill(jo.username);
  await dialog.getByRole("button", { name: "What they can do" }).click();
  await page.getByRole("menuitemradio", { name: /^Can view/ }).click();
  // A reload keeps who's being invited, and as what.
  await page.reload();
  await expect(dialog.getByPlaceholder("username or email")).toHaveValue(jo.username);
  await expect(dialog.getByRole("button", { name: "What they can do" })).toHaveText("Can view");
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  const role = dialog.getByRole("button", { name: `What @${jo.username} can do` });
  await expect(role).toHaveText("Can view");
  // Saved, and Share is still open after a reload.
  await page.reload();
  await expect(role).toHaveText("Can view");
});

test("a viewer sees a shared list but can't change it", async ({ page, user }) => {
  user.addList("Mine");
  const lorna = await createPerson();
  lorna.shareList("Lorna's week", ["Swim"], user.id, user.username, "viewer");
  await page.goto("/board");
  await expect(page.getByText("View only", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add item to Lorna's week" })).toHaveCount(0);
  const tick = page.getByRole("checkbox", { name: "Not done" });
  await expect(tick).toHaveAttribute("aria-readonly", "true");
  await tick.click();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Not done" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("View only", { exact: true })).toBeVisible();
});

test("invites someone to several lists at once", async ({ page, user, browser, baseURL }) => {
  user.addList("Groceries");
  user.addList("Chores");
  const jo = await createPerson();
  await page.goto("/board");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Invite people…" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite people" });
  await dialog.getByLabel("Who to invite").fill(jo.username);
  await dialog.getByRole("checkbox", { name: "Invite to Groceries" }).click();
  await dialog.getByRole("checkbox", { name: "Invite to Chores" }).click();
  await dialog.getByRole("button", { name: "What they can do on Chores" }).click();
  await page.getByRole("menuitemradio", { name: /^Can view/ }).click();
  // A reload keeps the dialog and everything in it.
  await page.reload();
  await expect(dialog.getByRole("button", { name: `Don't invite ${jo.username}` })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Invite to Groceries" })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "What they can do on Chores" })).toHaveText("Can view");
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Jo has both invites, each with the role chosen for it.
  const context = await browser.newContext();
  await jo.signIn(context, baseURL ?? "");
  const joPage = await context.newPage();
  await joPage.goto("/brief");
  await expect(joPage.getByText("invited you to “Groceries”")).toBeVisible();
  await expect(joPage.getByText("invited you to “Chores”")).toBeVisible();
  const accept = joPage.getByRole("button", { name: "Accept" });
  await accept.first().click();
  await expect(accept).toHaveCount(1);
  await accept.click();
  await expect(accept).toHaveCount(0);
  await joPage.goto("/board");
  await expect(joPage.getByRole("button", { name: "Add item to Groceries" })).toBeVisible();
  await expect(joPage.getByRole("button", { name: "Add item to Chores" })).toHaveCount(0);
  await expect(joPage.getByText("View only", { exact: true })).toHaveCount(1);
  await context.close();
});

test("shares a list so someone sees only your items", async ({ page, user, browser, baseURL }) => {
  const list = user.addList("Week", ["Someone else's errand"]);
  user.addItem(list.id, "Swim", [user.id]);
  const jo = await createPerson();
  await page.goto("/board");
  await page.getByRole("button", { name: "List options" }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = page.getByRole("dialog", { name: "Share “Week”" });
  await dialog.getByPlaceholder("username or email").fill(jo.username);
  await dialog.getByRole("button", { name: "What they can do" }).click();
  await page.getByRole("menuitemradio", { name: /^Can view/ }).click();
  await dialog.getByRole("button", { name: "What they can do" }).click();
  await page.getByRole("menuitemcheckbox", { name: /^Only my items/ }).click();
  await expect(dialog.getByRole("button", { name: "What they can do" })).toHaveText("Can view, my items");
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(dialog.getByRole("button", { name: `What @${jo.username} can do` })).toHaveText(
    "Can view, my items",
  );

  const context = await browser.newContext();
  await jo.signIn(context, baseURL ?? "");
  const joPage = await context.newPage();
  await joPage.goto("/brief");
  await joPage.getByRole("button", { name: "Accept" }).click();
  await joPage.goto("/board");
  await expect(joPage.getByText("Swim")).toBeVisible();
  await expect(joPage.getByText(/View only, E2E’s items/i)).toBeVisible();
  await expect(joPage.getByText("Someone else's errand")).toHaveCount(0);
  await context.close();
});

test("shares a Space so someone sees only your items", async ({ page, user, browser, baseURL }) => {
  const list = user.addList("Week", ["Someone else's errand"]);
  user.addItem(list.id, "Swim", [user.id]);
  user.addSpace("Fam", [list.id]);
  const jo = await createPerson();
  await page.goto("/settings/spaces");
  await page.getByLabel("Invite someone to Fam").fill(jo.username);
  await page.getByRole("button", { name: "What they can do" }).click();
  await page.getByRole("menuitemradio", { name: /^Can view/ }).click();
  await page.getByRole("button", { name: "What they can do" }).click();
  await page.getByRole("menuitemcheckbox", { name: /^Only my items/ }).click();
  // A tick keeps the menu open.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const row = page.getByRole("button", { name: `What @${jo.username} can do` });
  await expect(row).toHaveText("Can view, my items");
  await page.reload();
  await expect(row).toHaveText("Can view, my items");

  const context = await browser.newContext();
  await jo.signIn(context, baseURL ?? "");
  const joPage = await context.newPage();
  await joPage.goto("/brief");
  await joPage.getByRole("button", { name: "Join" }).click();
  await joPage.goto("/board");
  await expect(joPage.getByText("Swim")).toBeVisible();
  await expect(joPage.getByText("Someone else's errand")).toHaveCount(0);
  await context.close();
});
