import { expect, test, type Page } from "@playwright/test";
import { formatPhone } from "../src/lib/format-phone";
import { latestOtp } from "./otp";

// M-IP2-2 founder journey with a CDP virtual authenticator: OTP in, enroll a
// named passkey, sign out, sign back in with ONLY the passkey, manage sessions.

const PHONE = `91${String(Date.now()).slice(-8)}`;

async function otpLogin(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  // Await the send completing (data-step flips only after the action commits)
  // before reading the inbox — the login.spec idiom; a bare read races the mint.
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  const code = await latestOtp(phone);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  // PX-3: new accounts land on onboarding; security panels live on /account.
  // The name gate now guards /account like every other console route, so a
  // fresh account must clear onboarding before the goto below can land there.
  await expect(page).toHaveURL(/\/(home|onboarding)/);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("Passkey Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
  await page.goto("/account");
}

test("the founder journey: enroll passkey, sign out, passkey-only sign in", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await otpLogin(page, PHONE);

  await page.getByLabel("Device name").fill("Founder MacBook");
  await page.getByTestId("enroll-passkey").click();
  // Scoped to the NAME, not to every mention of it. The device row grew
  // accessible controls — "Rename Founder MacBook", "Remove Founder MacBook" —
  // so a bare text match now resolves to three elements and trips strict mode.
  // That is the a11y work doing its job; the spec just has to be specific.
  await expect(page.locator(".security-name", { hasText: "Founder MacBook" })).toBeVisible();
  // The security log reads as prose now ("Passkey added"), not as the raw
  // action key — a person reading their own account should not have to parse
  // `auth.passkey.enrolled`. The key is still what gets stored; this is the
  // rendering.
  await expect(page.getByTestId("events-panel")).toContainText("Passkey added");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByTestId("passkey-login").click();
  await expect(page).toHaveURL(/\/(home|onboarding)/, { timeout: 10_000 });
  await page.goto("/account");
  await expect(page.getByTestId("account-phone")).toHaveText(formatPhone(`+91${PHONE}`));
  await expect(page.getByTestId("events-panel")).toContainText("Signed in with a passkey");
});

test("session management: a second device shows up and can be revoked", async ({
  browser,
  page,
}) => {
  const phone = `92${String(Date.now()).slice(-8)}`;
  await otpLogin(page, phone);

  // A REAL user-agent, because the panel no longer prints raw ones. Sessions
  // are labelled "Firefox on Windows" now rather than the first 48 characters
  // of a UA string — a person recognising their own device is the entire point
  // of the screen. "OtherDevice/1.0" parses to "Unknown device", which would
  // make this assertion pass for the wrong reason on any unparsed session.
  const other = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  });
  const otherPage = await other.newPage();
  await otpLogin(otherPage, phone);
  await other.close();

  await page.reload();
  const panel = page.getByTestId("sessions-panel");
  await expect(panel).toContainText("Firefox on Windows");
  await panel.getByRole("button", { name: "Revoke" }).first().click();
  // Signing another device out is irreversible, so it asks first. The click
  // above only OPENS that dialog; without answering it the session was never
  // revoked and the row stayed exactly where it was.
  await page.getByTestId("confirm-security-action").click();
  await expect(panel).not.toContainText("Firefox on Windows");
  await expect(page.getByTestId("events-panel")).toContainText("A device was signed out");
});
