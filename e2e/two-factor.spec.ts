import { totpCode } from "@/auth/totp.test-helper";
import { expect, test } from "./fixtures";

test("sets up two-factor sign-in, then signs in with a code", async ({ page, user }) => {
  // From Get started's card, which opens setup at the password step. It's
  // offered once there's something to protect: ten items.
  user.addList("Home", Array.from({ length: 10 }, (_, n) => `Item ${n + 1}`));
  await page.goto("/brief");
  const getStarted = page.getByRole("region", { name: "Get started" });
  await getStarted.getByRole("button", { name: "Secure your account" }).click();
  await getStarted.getByRole("link", { name: "Set up two-factor" }).click();
  const panel = page.getByRole("region", { name: "Two-factor sign-in" });
  await panel.getByRole("textbox", { name: "Your password" }).fill(user.password);
  await panel.getByRole("button", { name: "Continue" }).click();

  // What someone without a camera types into their app.
  const key = (await panel.getByLabel("Setup key").textContent())?.replace(/\s/g, "") ?? "";
  const uri = `otpauth://totp/Sidetrack?secret=${key}`;
  // The sixth digit checks the code: no button to press.
  await panel.getByRole("textbox", { name: "Code from your app" }).fill(totpCode(uri));
  await expect(panel.getByRole("list", { name: "Backup codes" }).getByRole("listitem")).toHaveCount(10);
  await panel.getByRole("button", { name: "I've saved them" }).click();
  await expect(panel.getByText("On", { exact: true })).toBeVisible();

  // Signing in now asks for a code after the password.
  await page.context().clearCookies();
  await page.goto("/login?next=%2Fsettings%2Fprofile");
  await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\/two-factor/);
  await page.getByRole("textbox", { name: "Authentication code" }).fill(totpCode(uri));

  // Signed in, back where they were headed, and it's still on.
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(
    page.getByRole("region", { name: "Two-factor sign-in" }).getByText("On", { exact: true }),
  ).toBeVisible();
  // And Get started has ticked it.
  await page.goto("/brief");
  await expect(
    page.getByRole("region", { name: "Get started" }).getByRole("listitem").filter({ hasText: "Secure your account" }),
  ).toContainText("Done");
});
