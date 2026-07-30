import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PX-3 Authentication & Onboarding — adversarial suite, updated for the
// 2026-07-24 council collapse: onboarding is ONE question (the name), the org
// wizard is gone (organizations are born on /orgs, where the work is), and
// /login + /onboarding render bare — no marketing chrome around the
// checkpoint. Unhappy paths (cooldowns, lockout, hijack-free tokens, session
// persistence, telemetry, a11y, mobile) all still covered.

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
  await page.getByLabel("6-digit code").fill(await readCode(page, phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
}

async function createOrg(page: Page, name: string): Promise<void> {
  await page.goto("/orgs");
  await page.getByTestId("new-org").click();
  await page.getByLabel("Organization name").filter({ visible: true }).fill(name);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTestId("org-name")).toHaveText(name);
}

test("founder journey: OTP → one question → home; orgs are born on /orgs, not at the gate", async ({
  page,
}) => {
  const phone = `70${STAMP}`;
  await otpLogin(page, phone);

  // A nameless account is onboarded before the console greets it — with the
  // ONE question the product genuinely needs, and nothing else.
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByTestId("onboarding-name")).toBeVisible();

  // The old wizard furniture is gone: no progress bar, no org step, no skip.
  await expect(page.locator(".onboarding-step-current")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-skip")).toHaveCount(0);

  // Refresh mid-step: the step is server-derived, not wizard state.
  await page.reload();
  await expect(page.getByTestId("onboarding-name")).toBeVisible();

  await page.getByLabel("What should we call you?").fill("Asha Rao");
  await page.getByRole("button", { name: "Continue" }).click();

  // Straight home — greeted by name. No org toll at the entrance.
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Asha Rao");

  // A named account revisiting /onboarding is simply sent home.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/home/);

  // Organizations are created where the work is.
  await createOrg(page, `Asha CC ${STAMP}`);
});

test("player-shaped users reach home directly; completion meter and notifications tell the truth", async ({
  page,
}) => {
  const phone = `71${STAMP}`;
  await otpLogin(page, phone);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("What should we call you?").fill("Vikram Iyer");
  await page.getByRole("button", { name: "Continue" }).click();
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

test("lockout: five wrong codes burn the OTP, and the screen says so instead of blaming the typist", async ({
  page,
}) => {
  const phone = `73${STAMP}`;
  await requestCode(page, phone);
  const realCode = await readCode(page, phone);

  // Four rejections, each counting down the rope that is left.
  for (const left of [4, 3, 2, 1]) {
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(
      page.getByText(`That code isn't right. ${left} ${left === 1 ? "attempt" : "attempts"} left.`),
    ).toBeVisible();
  }
  // The fifth burns it. The old build said "That code didn't work. Try again."
  // here and forever after — advice that could never succeed — and left the
  // user holding the CORRECT code with nothing on screen to tell them why it
  // was refused. The state is now named, and the way out is pointed at.
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(
    page.getByText("Too many attempts on this code. Tap 'Resend code' to get a new one."),
  ).toBeVisible();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-locked", "true");

  // Attempt ceiling reached: the genuine code is dead too (attack cannot
  // brute-force), and another guess is not even offered.
  await expect(page.getByRole("button", { name: "Verify and continue" })).toBeDisabled();
  await page.getByLabel("6-digit code").fill(realCode);
  await expect(page).toHaveURL(/\/login/);

  // The escape is real: a fresh code clears the lockout and signs in. The
  // resend button may still be inside its 30s countdown — five guesses take a
  // browser a couple of seconds — and the countdown IS the route, since it
  // names the action and when it opens. Wait it out rather than asserting a
  // race.
  await expect(page.getByTestId("resend-code")).toBeEnabled({ timeout: 35_000 });
  await page.getByTestId("resend-code").click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-locked", "false");
  await page.getByLabel("6-digit code").fill(await readCode(page, phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
});

test("the step lives in the URL: a refresh mid-code-step keeps the number and the field", async ({
  page,
}) => {
  const phone = `79${STAMP}`;
  await requestCode(page, phone);
  await expect(page).toHaveURL(/step=code/);

  // Leaving the browser to read the SMS is the mandatory middle step on a
  // phone, and a backgrounded tab is evicted routinely. A reload used to come
  // back on the phone step with the number FORGOTTEN, and re-typing it inside
  // 30s hit the resend cooldown — a user holding a valid code with no field to
  // type it into.
  await page.reload();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  await page.getByLabel("6-digit code").fill(await readCode(page, phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
});

test("deep links cannot skip onboarding: a nameless account is gated on every console route", async ({
  page,
}) => {
  const phone = `80${STAMP}`;
  // Signed-out console routes redirect through ?next=, which used to make
  // BYPASSING the default: verify, land on /orgs, never see onboarding again,
  // and appear as a raw phone number on team sheets forever after.
  await page.goto("/orgs");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 15_000,
  });
  await page.getByLabel("6-digit code").fill(await readCode(page, phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  // And typing any console URL by hand comes straight back here.
  for (const route of ["/orgs", "/tournaments", "/account", "/inbox", "/seasons"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/onboarding/);
  }
});

test("token flows are never hijacked by onboarding, and telemetry captures the funnel", async ({
  browser,
  page,
}) => {
  const organizer = `74${STAMP}`;
  const invitee = `75${STAMP}`;

  // Organizer onboards (one question), creates the org on /orgs, mints an invite.
  await otpLogin(page, organizer);
  await page.getByLabel("What should we call you?").fill("Meera Organizer");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home/);
  await createOrg(page, `Meera CC ${STAMP}`);
  // "Invite member" lives on the org detail page's Members tab; the tab panels
  // for the other sections render in the DOM but display:none until selected,
  // so the trigger is invisible until the tab itself is active.
  await page.getByRole("tab", { name: "Members" }).click();
  // "create-invite" is the dialog's submit, not its trigger. A closed <dialog>
  // keeps its markup but is display:none, so clicking straight through resolved
  // the element and then waited 60s for a button that could never be visible.
  await page.getByTestId("open-invite").click();
  await page.getByRole("dialog").getByTestId("create-invite").click();
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
    await pageB.getByLabel("6-digit code").fill(await readCode(pageB, invitee));
    await pageB.getByRole("button", { name: "Verify and continue" }).click();
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
  await expect(page).toHaveURL(/\/home/);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Persistent Pat");

  // Session gone (expiry equivalent): console gates, then next returns exactly.
  await page.context().clearCookies();
  await page.goto("/seasons");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByText("Sign in to continue where you were headed.")).toBeVisible();
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
    timeout: 15_000,
  });
  await page.getByLabel("6-digit code").fill(await readCode(page, phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  // Named user, next honored — straight back to work, no onboarding detour.
  await expect(page).toHaveURL(/\/seasons/);
});

test("accessibility: onboarding, inbox and account scan clean", async ({ page }) => {
  const phone = `77${STAMP}`;
  await otpLogin(page, phone);
  await expect(page.getByTestId("onboarding-name")).toBeVisible();
  const onboardingScan = await new AxeBuilder({ page }).analyze();
  expect(onboardingScan.violations, JSON.stringify(onboardingScan.violations, null, 2)).toEqual([]);

  await page.getByLabel("What should we call you?").fill("Axe Auditor");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home/);

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
    await expect(page).toHaveURL(/\/home/);
    await page.goto("/orgs");
    await page.getByTestId("new-org").click();
    await page.getByLabel("Organization name").filter({ visible: true }).fill(`Mira XI ${STAMP}`);
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
