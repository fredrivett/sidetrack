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
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  const role = dialog.getByRole("button", { name: `What @${jo.username} can do` });
  await expect(role).toHaveText("Can view");
  await page.reload();
  await page.getByRole("button", { name: "List options" }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
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
