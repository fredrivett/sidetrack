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

test("shares your day, which shows on their Check-ins, not their board", async ({ page, user, browser, baseURL }) => {
  const list = user.addList("Week");
  user.addItem(list.id, "Overdue swim", [user.id], "2020-01-06");
  user.addItem(list.id, "Next year's trip", [user.id], "2099-01-05");
  user.setDayNote("Tired — swim first, then the rest");
  const jo = await createPerson();
  await page.goto("/check-ins");
  await page.getByRole("button", { name: "Share my day" }).click();
  const dialog = page.getByRole("dialog", { name: "Share my day" });
  await dialog.getByLabel("Who to share your day with").fill(jo.username);
  await dialog.getByRole("checkbox", { name: "Share from Week" }).click();
  await dialog.getByRole("checkbox", { name: /How today feels/ }).click();
  await dialog.getByRole("button", { name: "Share my day" }).click();
  await expect(dialog).toHaveCount(0);

  const context = await browser.newContext();
  await jo.signIn(context, baseURL ?? "");
  const joPage = await context.newPage();
  // Her day waits on his Check-ins, not his board's invites.
  await joPage.goto("/check-ins");
  await joPage.getByRole("group", { name: "E2E User’s day, waiting for you" }).getByRole("button", { name: "Accept" }).click();
  const day = joPage.getByRole("region", { name: "E2E User’s day" });
  await expect(day).toBeVisible();
  await joPage.goto("/board");
  await expect(joPage.getByText("No lists yet")).toBeVisible();
  await joPage.goto("/check-ins");
  await expect(day.getByText("Overdue swim")).toBeVisible();
  await expect(day.getByText("0 of 1 done")).toBeVisible();
  // The mood she chose to share, not the words she didn't.
  await expect(day.getByRole("list", { name: "How today feels" }).getByText("Tired")).toBeVisible();
  await expect(day.getByText("swim first")).toHaveCount(0);
  await expect(joPage.getByText("Next year's trip")).toHaveCount(0);

  // She sees who sees her day, and can take back her mood, then stop altogether.
  await page.reload();
  await expect(page.getByText("Who sees your day")).toBeVisible();
  await page.getByRole("button", { name: "What Other sees" }).click();
  await page.getByRole("menuitemcheckbox", { name: "How today feels" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Today", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Today", { exact: true })).toBeVisible();
  await joPage.reload();
  await expect(day.getByText("Overdue swim")).toBeVisible();
  await expect(day.getByRole("list", { name: "How today feels" })).toHaveCount(0);

  await page.getByRole("button", { name: "What Other sees" }).click();
  await page.getByRole("menuitem", { name: "Stop sharing with Other" }).click();
  await expect(page.getByText("Only you see this.")).toBeVisible();
  await joPage.reload();
  await expect(joPage.getByText("Nobody shares their day with you yet.")).toBeVisible();
  await context.close();
});

test("shares your day on lists you already share with them too, without picking them", async ({ page, user, browser, baseURL }) => {
  const gym = user.addList("Gym");
  user.addItem(gym.id, "Overdue swim", [user.id], "2020-01-06");
  const jo = await createPerson();
  const errands = jo.shareList("Errands", [], user.id, user.username, "editor");
  user.addItem(errands.id, "Post the parcel", [user.id], "2020-01-06");
  user.addItem(errands.id, "Some day errand", [user.id]);
  await page.goto("/check-ins");
  await page.getByRole("button", { name: "Share my day" }).click();
  const dialog = page.getByRole("dialog", { name: "Share my day" });
  await dialog.getByLabel("Who to share your day with").fill(jo.username);
  await dialog.getByRole("checkbox", { name: "Share from Gym" }).click();
  await dialog.getByRole("button", { name: "Share my day" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your day" }).getByText("Post the parcel")).toBeVisible();

  const context = await browser.newContext();
  await jo.signIn(context, baseURL ?? "");
  const joPage = await context.newPage();
  await joPage.goto("/check-ins");
  await joPage.getByRole("group", { name: "E2E User’s day, waiting for you" }).getByRole("button", { name: "Accept" }).click();
  const day = joPage.getByRole("region", { name: "E2E User’s day" });
  await expect(day.getByText("Overdue swim")).toBeVisible();
  await expect(day.getByText("Post the parcel")).toBeVisible();
  await expect(day.getByText("0 of 2 done")).toBeVisible();
  await expect(day.getByText("Some day errand")).toHaveCount(0);

  // Due today now, it joins her card live, though only its row changed.
  await page.goto("/board");
  await page.getByRole("button", { name: "Some day errand", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Due date" }).click();
  await page.getByRole("menuitem", { name: "Today" }).click();
  await expect(day.getByText("Some day errand")).toBeVisible();
  await context.close();
});

test("shares your day with someone you already share lists with, picking nothing", async ({ page, user, browser, baseURL }) => {
  const jo = await createPerson();
  const errands = jo.shareList("Errands", [], user.id, user.username, "editor");
  user.addItem(errands.id, "Post the parcel", [user.id], "2020-01-06");
  await page.goto("/check-ins");
  await page.getByRole("button", { name: "Share my day" }).click();
  const dialog = page.getByRole("dialog", { name: "Share my day" });
  await dialog.getByLabel("Who to share your day with").fill(jo.username);
  // What they already see is ticked and locked, and enough to share.
  await expect(dialog.getByRole("checkbox", { name: "Already shared: Errands" })).toBeChecked();
  await dialog.getByRole("button", { name: "Share my day" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Invite pending")).toBeVisible();

  const context = await browser.newContext();
  await jo.signIn(context, baseURL ?? "");
  const joPage = await context.newPage();
  await joPage.goto("/check-ins");
  await joPage.getByRole("group", { name: "E2E User’s day, waiting for you" }).getByRole("button", { name: "Accept" }).click();
  const day = joPage.getByRole("region", { name: "E2E User’s day" });
  await expect(day.getByText("Post the parcel")).toBeVisible();
  await joPage.reload();
  await expect(day.getByText("Post the parcel")).toBeVisible();

  // He stops seeing it: it ends for her too, and he keeps Errands.
  await joPage.getByRole("button", { name: "E2E User’s day options" }).click();
  await joPage.getByRole("menuitem", { name: "Stop seeing E2E User’s day" }).click();
  await expect(joPage.getByText("Nobody shares their day with you yet.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Only you see this.")).toBeVisible();
  await context.close();
});

test("shares your day on someone else's list you edit, not one you only comment on", async ({ page, user }) => {
  const fred = await createPerson();
  const home = fred.shareList("Fred's home", [], user.id, user.username, "editor");
  fred.shareList("Fred's notes", [], user.id, user.username, "commenter");
  user.addItem(home.id, "Water the plants", [user.id], "2020-01-06");
  const jo = await createPerson();
  await page.goto("/check-ins");
  await page.getByRole("button", { name: "Share my day" }).click();
  const dialog = page.getByRole("dialog", { name: "Share my day" });
  await expect(dialog.getByRole("checkbox", { name: "Share from Fred's notes" })).toHaveAttribute("aria-disabled", "true");
  await expect(dialog.getByText("You can't edit this list")).toBeVisible();
  await dialog.getByLabel("Who to share your day with").fill(jo.username);
  await dialog.getByRole("checkbox", { name: "Share from Fred's home" }).click();
  await dialog.getByRole("button", { name: "Share my day" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Who sees your day")).toBeVisible();
  await expect(page.getByText("Water the plants")).toBeVisible();
});

test("offers to invite someone who isn't on Sidetrack yet, by email, to see your day", async ({ page, user }) => {
  user.addList("Week");
  await page.goto("/check-ins");
  await page.getByRole("button", { name: "Share my day" }).click();
  const dialog = page.getByRole("dialog", { name: "Share my day" });
  await dialog.getByRole("checkbox", { name: "Share from Week" }).click();
  await dialog.getByLabel("Who to share your day with").fill("nobody@example.com");
  await dialog.getByRole("button", { name: "Share my day" }).click();
  await expect(dialog.getByText("nobody@example.com isn’t on Sidetrack yet.")).toBeVisible();
  await dialog.getByRole("button", { name: "Email an invite" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Who sees your day")).toBeVisible();
  await expect(page.getByText("nobody@example.com")).toBeVisible();
  await expect(page.getByText("Invited, not joined yet")).toBeVisible();
});

test("someone invited by email joins through the link and sees your week", async ({ page, user, browser, baseURL }) => {
  const list = user.addList("Week");
  user.addItem(list.id, "Book the dentist", [user.id], "2020-01-06");
  const email = `new-${user.username}@example.com`;
  const link = user.shareWeekByEmail(email, [list.id]);

  const context = await browser.newContext();
  const theirs = await context.newPage();
  await theirs.goto(`${baseURL}${link}`);
  await expect(theirs.getByText("E2E User wants to share their week with you")).toBeVisible();
  await expect(theirs.getByLabel("Email")).toHaveValue(email);
  await theirs.getByLabel("Username").fill(`n${user.username}`.slice(0, 30));
  await theirs.getByLabel("Password").fill("newcomer-password");
  await theirs.getByRole("button", { name: /Create account|Sign up/ }).click();
  await expect(theirs).toHaveURL(/\/check-ins$/);
  const week = theirs.getByRole("region", { name: "E2E User’s week" });
  await expect(week.getByText("Book the dentist")).toBeVisible();

  // The link works once.
  await context.clearCookies();
  await theirs.goto(`${baseURL}${link}`);
  await expect(theirs.getByText("This invite has expired or been used")).toBeVisible();

  // And they're who sees your day now.
  await page.goto("/check-ins");
  await expect(page.getByText("Who sees your day")).toBeVisible();
  await expect(page.getByText("Invited, not joined yet")).toHaveCount(0);

  // Your profile says you invited them.
  await page.goto("/settings/profile");
  await expect(page.getByRole("region", { name: "Invites" }).getByText(`@n${user.username}`.slice(0, 31))).toBeVisible();
});

test("invites a friend to Sidetrack, and cancels the invite", async ({ page, user }) => {
  void user;
  await page.goto("/check-ins");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Invite a friend…" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a friend" });
  await dialog.getByLabel("Their email").fill("friend@example.com");
  await dialog.getByRole("button", { name: "Send invite" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Invite a friend…" }).click();
  await expect(dialog.getByRole("region", { name: "Invited, not joined yet" }).getByText("friend@example.com")).toBeVisible();
  await dialog.getByRole("button", { name: "Invite to friend@example.com" }).click();
  await page.getByRole("menuitem", { name: "Cancel invite" }).click();
  await expect(dialog.getByText("friend@example.com")).toHaveCount(0);
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Invited, not joined yet" })).toHaveCount(0);
});

test("your profile's Invites links to inviting a friend and sharing your day", async ({ page, user }) => {
  void user;
  await page.goto("/settings/profile");
  const invites = page.getByRole("region", { name: "Invites" });
  await invites.getByRole("link", { name: "Invite a friend" }).click();
  await expect(page.getByRole("dialog", { name: "Invite a friend" })).toBeVisible();
  await expect(page).toHaveURL(/\/brief$/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/settings/profile");
  await invites.getByRole("link", { name: "share your day" }).click();
  await expect(page.getByRole("dialog", { name: "Share my day" })).toBeVisible();
  await expect(page).toHaveURL(/\/check-ins$/);
});
