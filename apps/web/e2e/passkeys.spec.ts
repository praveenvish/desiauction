import { expect, test, type Page } from "@playwright/test";

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
  const inbox = await page.context().newPage();
  await inbox.goto(`/dev/inbox?phone=${encodeURIComponent(`+91${phone}`)}`);
  const code = await inbox.getByTestId(`code-+91${phone}`).first().textContent();
  await inbox.close();
  await page.getByLabel(`Code sent to +91${phone}`).fill(code ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // PX-3: new accounts land on onboarding; security panels live on /account.
  await expect(page).toHaveURL(/\/(home|onboarding)/);
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
  await expect(page.getByText("Founder MacBook")).toBeVisible();
  await expect(page.getByTestId("events-panel")).toContainText("auth.passkey.enrolled");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByTestId("passkey-login").click();
  await expect(page).toHaveURL(/\/(home|onboarding)/, { timeout: 10_000 });
  await page.goto("/account");
  await expect(page.getByTestId("account-phone")).toHaveText(`+91${PHONE}`);
  await expect(page.getByTestId("events-panel")).toContainText("auth.login.passkey");
});

test("session management: a second device shows up and can be revoked", async ({
  browser,
  page,
}) => {
  const phone = `92${String(Date.now()).slice(-8)}`;
  await otpLogin(page, phone);

  const other = await browser.newContext({ userAgent: "OtherDevice/1.0" });
  const otherPage = await other.newPage();
  await otpLogin(otherPage, phone);
  await other.close();

  await page.reload();
  const panel = page.getByTestId("sessions-panel");
  await expect(panel).toContainText("OtherDevice/1.0");
  await panel.getByRole("button", { name: "Revoke" }).first().click();
  await expect(panel).not.toContainText("OtherDevice/1.0");
  await expect(page.getByTestId("events-panel")).toContainText("auth.session.revoked");
});
