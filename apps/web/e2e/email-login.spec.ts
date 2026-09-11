import { createDb, otpInbox, people } from "@desiauction/db";
import { expect, test } from "@playwright/test";
import { desc, eq } from "drizzle-orm";

import { latestOtp } from "./otp";

/*
 * SIGNING IN WITH A MAILBOX.
 *
 * The second door, added because Indian SMS needs DLT registration with TRAI
 * before a single transactional message can be sent — a queue measured in days
 * — while email needs none. Phone stays primary: a player's registration and
 * their place on a roster key on a phone number.
 *
 * The dev mailer writes to the same `otp_inbox` the sign-in codes go to, so a
 * browser test can read what was actually mailed rather than trusting that
 * something was.
 */
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";

const STAMP = String(Date.now()).slice(-8);
const PHONE = `86${STAMP}`;
const EMAIL = `login${STAMP}@example.test`;

/** What the dev mailer put in the inbox for an address. */
async function mailedCode(address: string): Promise<string> {
  const handle = createDb(DATABASE_URL);
  try {
    for (let i = 0; i < 50; i++) {
      const [row] = await handle.db
        .select({ code: otpInbox.code })
        .from(otpInbox)
        .where(eq(otpInbox.phone, address))
        .orderBy(desc(otpInbox.createdAt))
        .limit(1);
      if (row !== undefined) return row.code;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`nothing was mailed to ${address}`);
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

/** Confirm the address directly — the change flow has its own coverage. */
async function verifyAddress(phone: string, address: string): Promise<void> {
  const handle = createDb(DATABASE_URL);
  try {
    await handle.db
      .update(people)
      .set({ email: address, emailVerifiedAt: new Date() })
      .where(eq(people.phone, `+91${phone}`));
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

test("a verified email is a second way into the same account", async ({ page }) => {
  test.setTimeout(120_000);

  // Establish the account through the PRIMARY path, which must keep working.
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  await page.getByLabel("6-digit code").fill(await latestOtp(PHONE));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill("Email Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
  await verifyAddress(PHONE, EMAIL);

  // Sign out, then come back through the OTHER door.
  await page.goto("/account");
  await page
    .getByRole("button", { name: /Sign out/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/(login|$)/, { timeout: 20_000 });

  await page.goto("/login");
  // SECONDARY, and collapsed: the ordinary path stays one field and one button.
  const email = page.getByTestId("email-login-address");
  await expect(email).toBeHidden();
  await page.getByText("Use your email instead").click();
  await email.fill(EMAIL);
  await page.getByTestId("email-login-send").click();

  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("email-login-code").fill(await mailedCode(EMAIL));
  await page.getByTestId("email-login-verify").click();

  // The SAME account. Authorization keys on personId and cannot tell which
  // door was used.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  await page.goto("/account");
  await expect(page.getByText("Email Tester").first()).toBeVisible({ timeout: 20_000 });
});

test("an address nobody owns is answered exactly like one that exists", async ({ page }) => {
  /*
   * NO ENUMERATION. A mailbox is a far better guess than a phone number, so a
   * form that behaved differently for unknown addresses would be a membership
   * oracle for anybody holding a list of them. The step advances either way and
   * the wording never claims a code was sent.
   */
  await page.goto("/login");
  await page.getByText("Use your email instead").click();
  await page.getByTestId("email-login-address").fill(`nobody${STAMP}@example.test`);
  await page.getByTestId("email-login-send").click();
  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("email-login-sent")).toContainText("If ");
});

test("an address nobody owns creates the account it signs in to", async ({ page }) => {
  /*
   * PHASE 2 — the sign-UP half of the same door (migrations 0062 and 0063).
   *
   * The account is anchored by the ADDRESS and holds no phone at all, which is
   * the whole point: Indian SMS needs DLT registration with TRAI before a
   * single transactional message can be sent, and an organizer who cannot wait
   * for that queue now has a way in that does not involve one.
   *
   * Note what this proves that the server test cannot: that the flow lands the
   * person somewhere usable. A brand-new account has no name, so it must reach
   * /onboarding rather than /home — the same redirect the phone door makes, for
   * the same reason.
   */
  test.setTimeout(120_000);
  const fresh = `newcomer${STAMP}@example.test`;

  await page.goto("/login");
  await page.getByText("Use your email instead").click();
  await page.getByTestId("email-login-address").fill(fresh);
  await page.getByTestId("email-login-send").click();
  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("email-login-code").fill(await mailedCode(fresh));
  await page.getByTestId("email-login-verify").click();

  // Nameless, so the door opens onto the name gate — never /home.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });

  // ANCHORED BY THE ADDRESS AND NOTHING ELSE. If this row had a phone, 0062
  // would not have been needed and the whole phase is theatre.
  const handle = createDb(DATABASE_URL);
  try {
    const [row] = await handle.db
      .select({ phone: people.phone, verifiedAt: people.emailVerifiedAt })
      .from(people)
      .where(eq(people.email, fresh))
      .limit(1);
    expect(row, "the code should have created the account").toBeDefined();
    expect(row?.phone).toBeNull();
    expect(row?.verifiedAt).not.toBeNull();
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
});

test("an email-anchored account is told to add a number before it can play", async ({ page }) => {
  /*
   * THE PLAYER RULE, at the surface a player actually meets.
   *
   * An account with no phone can organize, own a team and keep the books — all
   * of that is worked through this website. It cannot enter a season, because a
   * season reaches its players by SMS and by nothing else: approval, the
   * auction-day summons, the sold message. Entering somebody we cannot text
   * would approve, auction and sell them without ever telling them.
   *
   * Said BEFORE the form rather than at Submit, and with somewhere to go.
   * `submitRegistration` refuses it at the server too — this is the half that
   * does not waste three steps of someone's evening first.
   */
  test.setTimeout(120_000);
  const player = `wouldbeplayer${STAMP}@example.test`;

  await page.goto("/login");
  await page.getByText("Use your email instead").click();
  await page.getByTestId("email-login-address").fill(player);
  await page.getByTestId("email-login-send").click();
  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("email-login-code").fill(await mailedCode(player));
  await page.getByTestId("email-login-verify").click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });

  // The name gate identifies them by the ADDRESS, because there is no number to
  // identify them by. Before 0062 this line read `formatPhone(null)` and would
  // have greeted a brand-new organizer with a blank.
  await expect(page.getByText(player, { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  // Through the gate — /account bounces a nameless account straight back here,
  // so the name has to be given before the account page can be reached at all.
  await page.getByRole("textbox").first().fill("Email Organizer");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/onboarding/, { timeout: 30_000 });

  // The account page offers to ADD rather than to change — there is nothing to
  // change yet, and promising to text the old number would be a promise to
  // nobody.
  await page.goto("/account");
  await expect(page.getByTestId("open-phone-change")).toHaveText("Add mobile number", {
    timeout: 20_000,
  });
  // And the contact line shows the address, not an empty cell.
  await expect(page.getByTestId("account-phone")).toHaveText(player);
});
