import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PX-3 Authentication & Onboarding — adversarial suite. Covers the founder
// journey plus the unhappy paths: cooldowns, lockout, refresh-survival,
// hijack-free token flows, session persistence, telemetry, a11y, mobile.

const STAMP = String(Date.now()).slice(-8);

async function requestCode(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 15_000,
  });
}

async function readCode(page: Page, phone: string): Promise<string> {
  const inbox = await page.context().newPage();
  await inbox.goto(`/dev/inbox?phone=${encodeURIComponent(`+91${phone}`)}`);
  const code = await inbox.getByTestId(`code-+91${phone}`).first().textContent();
  await inbox.close();
  return code ?? "";
}

async function otpLogin(page: Page, phone: string): Promise<void> {
  await requestCode(page, phone);
  await page.getByLabel(`Code sent to +91${phone}`).fill(await readCode(page, phone));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("founder journey: OTP → name → create org → personalized home; every step survives refresh", async ({
  page,
}) => {
  const phone = `70${STAMP}`;
  await otpLogin(page, phone);

  // A nameless account is onboarded before the console greets it.
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByTestId("onboarding-name")).toBeVisible();
  await expect(page.locator(".onboarding-step-current")).toContainText("Your name");

  // Refresh mid-step: the step is server-derived, not wizard state.
  await page.reload();
  await expect(page.getByTestId("onboarding-name")).toBeVisible();

  await page.getByLabel("What should we call you?").fill("Asha Rao");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("onboarding-org")).toBeVisible();
  await expect(page.locator(".onboarding-step-current")).toContainText("Your organization");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Asha Rao");

  // Refresh mid-step again: still the org step (name persisted server-side).
  await page.reload();
  await expect(page.getByTestId("onboarding-org")).toBeVisible();

  await page.getByLabel("Organization name").fill(`Asha CC ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`Asha CC ${STAMP}`);

  // Home greets by name; onboarding revisit confirms completion.
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Asha Rao");
  await page.goto("/onboarding");
  await expect(page.getByTestId("onboarding-done")).toBeVisible();
});

test("skip path: player-shaped users reach home; completion meter and notifications tell the truth", async ({
  page,
}) => {
  const phone = `71${STAMP}`;
  await otpLogin(page, phone);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill("Vikram Iyer");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("onboarding-skip").click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByText("Welcome to DesiAuction")).toBeVisible();

  // Profile completion: name yes, passkey no → 1/2.
  await page.goto("/account");
  await expect(page.getByTestId("profile-completion")).toContainText("Profile 1/2 complete");
  await expect(page.getByTestId("account-name")).toHaveText("Vikram Iyer");

  // Bell shows unread; inbox lists the real sign-in event; read-state settles.
  await expect(page.getByTestId("shell-bell")).toHaveAttribute("data-unread", "true");
  await page.getByTestId("shell-bell").click();
  await expect(page.getByTestId("inbox-list")).toContainText("Signed in with a one-time code");
  const firstRow = page.getByTestId("inbox-row").first();
  await expect(firstRow).toHaveAttribute("data-unread", "true");
  await page.reload();
  await expect(page.getByTestId("inbox-row").first()).toHaveAttribute("data-unread", "false");
  await expect(page.getByTestId("shell-bell")).toHaveAttribute("data-unread", "false");
});

test("resend is timed, cooldown is enforced by the server, and the number can be changed", async ({
  page,
}) => {
  const phone = `72${STAMP}`;
  await requestCode(page, phone);

  // Resend is locked behind the countdown right after a send.
  const resend = page.getByTestId("resend-code");
  await expect(resend).toBeDisabled();
  await expect(resend).toContainText(/Resend code in \d+s/);

  // Changing the number returns to the phone step without losing the value
  // (shown normalized, as the server echoed it).
  await page.getByTestId("change-number").click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "phone");
  await expect(page.getByLabel("Mobile number")).toHaveValue(`+91${phone}`);

  // Re-requesting immediately trips the server cooldown — shown, not crashed.
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(/Code already sent — wait 30 seconds/)).toBeVisible();
});

test("lockout: five wrong codes burn the OTP — even the correct code is then refused", async ({
  page,
}) => {
  const phone = `73${STAMP}`;
  await requestCode(page, phone);
  const realCode = await readCode(page, phone);

  for (let i = 0; i < 5; i += 1) {
    await page.getByLabel(`Code sent to +91${phone}`).fill("000000");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("That code didn't work. Try again.")).toBeVisible();
  }
  // Attempt ceiling reached: the genuine code is dead too (attack cannot brute-force).
  await page.getByLabel(`Code sent to +91${phone}`).fill(realCode);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That code didn't work. Try again.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("token flows are never hijacked by onboarding, and telemetry captures the funnel", async ({
  browser,
  page,
}) => {
  const organizer = `74${STAMP}`;
  const invitee = `75${STAMP}`;

  // Organizer onboards fully and mints an invite.
  await otpLogin(page, organizer);
  await page.getByLabel("What should we call you?").fill("Meera Organizer");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Organization name").fill(`Meera CC ${STAMP}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(`Meera CC ${STAMP}`);
  await page.getByTestId("create-invite").click();
  const inviteUrl = await page.getByTestId("invite-url").textContent();
  expect(inviteUrl).toContain("/join/");

  // A brand-new invitee lands on /join after login — NOT on /onboarding.
  const context = await browser.newContext();
  const pageB = await context.newPage();
  try {
    await pageB.goto(inviteUrl ?? "");
    await expect(pageB).toHaveURL(/\/login\?next=/);
    await pageB.getByLabel("Mobile number").fill(invitee);
    await pageB.getByRole("button", { name: "Send code" }).click();
    await expect(pageB.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
      timeout: 15_000,
    });
    await pageB.getByLabel(`Code sent to +91${invitee}`).fill(await readCode(pageB, invitee));
    await pageB.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(pageB).toHaveURL(/\/join\//);
    await pageB.getByTestId("accept-invite").click();
    await expect(pageB.getByTestId("org-name")).toHaveText(`Meera CC ${STAMP}`);

    // Telemetry ring buffer holds the funnel (abstraction only, no provider).
    const events = await pageB.evaluate(() =>
      (window.__daTelemetry ?? []).map((event) => event.name),
    );
    expect(events).toContain("org.invitation_accepted");

    // The invitee's /home now onboards for the missing name only.
    await pageB.goto("/home");
    await expect(pageB).toHaveURL(/\/onboarding/);
    await expect(pageB.getByTestId("onboarding-name")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("sessions persist across reloads; a cleared session gates and returns via next", async ({
  page,
}) => {
  const phone = `76${STAMP}`;
  await otpLogin(page, phone);
  await page.getByLabel("What should we call you?").fill("Persistent Pat");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("onboarding-skip").click();
  await expect(page).toHaveURL(/\/home/);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Persistent Pat");

  // Session gone (expiry equivalent): console gates, then next returns exactly.
  await page.context().clearCookies();
  await page.goto("/competitions");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByText("Sign in to continue where you were headed.")).toBeVisible();
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 15_000,
  });
  await page.getByLabel(`Code sent to +91${phone}`).fill(await readCode(page, phone));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Named user, next honored — straight back to work, no onboarding detour.
  await expect(page).toHaveURL(/\/competitions/);
});

test("accessibility: onboarding, inbox and account scan clean", async ({ page }) => {
  const phone = `77${STAMP}`;
  await otpLogin(page, phone);
  await expect(page.getByTestId("onboarding-name")).toBeVisible();
  const onboardingScan = await new AxeBuilder({ page }).analyze();
  expect(onboardingScan.violations, JSON.stringify(onboardingScan.violations, null, 2)).toEqual([]);

  await page.getByLabel("What should we call you?").fill("Axe Auditor");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("onboarding-skip").click();

  await page.goto("/inbox");
  await expect(page.getByTestId("inbox-list")).toBeVisible();
  const inboxScan = await new AxeBuilder({ page }).analyze();
  expect(inboxScan.violations, JSON.stringify(inboxScan.violations, null, 2)).toEqual([]);

  await page.goto("/account");
  await expect(page.getByTestId("profile-panel")).toBeVisible();
  const accountScan = await new AxeBuilder({ page }).analyze();
  expect(accountScan.violations, JSON.stringify(accountScan.violations, null, 2)).toEqual([]);
});

test("mobile 360px: the full entry journey works one-handed", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  try {
    const phone = `78${STAMP}`;
    await otpLogin(page, phone);
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel("What should we call you?").fill("Mobile Mira");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Organization name").fill(`Mira XI ${STAMP}`);
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page.getByTestId("org-name")).toHaveText(`Mira XI ${STAMP}`);
    // No horizontal scroll on the journey's surfaces; name offenders on failure.
    const offenders = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= limit) {
        return [];
      }
      return Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => el.getBoundingClientRect().right > limit + 1)
        .slice(0, 8)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 60)}`);
    });
    expect(offenders, offenders.join(" | ")).toEqual([]);
  } finally {
    await context.close();
  }
});
