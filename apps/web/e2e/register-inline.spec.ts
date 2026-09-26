import { competitions, createDb, newId, organizations, people } from "@desiauction/db";
import { expect, test, type Page } from "@playwright/test";

import { latestOtp } from "./otp";

/*
 * INLINE REGISTRATION (wow pass, 2026-09-25).
 *
 * The share link is the growth loop, and it used to end in a detour: the
 * register page's only button went to /login, and the visitor had to find
 * their way back. Verification is now step 1 of the register card itself —
 * the same server actions /login uses, with `next` = the register URL — so a
 * stranger on an OPEN, PUBLIC season goes from the link to "registered"
 * without the address bar ever showing /login.
 *
 * Both doors are covered: the mobile one (one code), and the email one, which
 * still owes a mobile number — the wizard collects it next, in place.
 */

const STAMP = String(Date.now()).slice(-8);
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";

test.describe.configure({ mode: "serial" });

/** An open, published season, minted directly: the UI path is not under test. */
async function insertOpenPublicSeason(stamp: string): Promise<{ name: string; path: string }> {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const db = handle.db;
    const creator = newId();
    const orgId = newId();
    const name = `Inline Cup ${stamp}`;
    const slug = `inline-cup-${stamp}`;
    await db.insert(people).values({ id: creator, phone: `+9180${stamp}`, name: "Inline Org" });
    await db.insert(organizations).values({
      id: orgId,
      name: `Inline Org ${stamp}`,
      slug: `inline-org-${stamp}`,
      createdBy: creator,
    });
    await db.insert(competitions).values({
      id: newId(),
      orgId,
      sport: "cricket",
      name,
      slug,
      status: "registration_open",
      visibility: "public",
      location: "Malad, Mumbai",
      startsOn: "2026-11-01",
      endsOn: "2026-11-20",
      createdBy: creator,
    });
    return { name, path: `/seasons/${slug}/register` };
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

/** Every URL the main frame navigates to, so "never visited /login" is provable. */
function recordNavigations(page: Page): string[] {
  const seen: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      seen.push(frame.url());
    }
  });
  return seen;
}

let season = { name: "", path: "" };

test.beforeAll(async () => {
  season = await insertOpenPublicSeason(STAMP);
});

test("a signed-out visitor registers by mobile without ever visiting /login", async ({ page }) => {
  test.setTimeout(120_000);
  const phone = `65${STAMP}`;
  const shared = `${season.path}?ref=whatsapp`;
  const visited = recordNavigations(page);

  await page.goto(shared);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(season.name);
  const verify = page.getByTestId("register-step-verify");
  await expect(verify).toBeVisible();
  // Step 1 of the same progress row the rest of the wizard uses.
  const progress = page.getByRole("list", { name: "Registration progress" });
  await expect(progress).toContainText("Verify");

  // Whatever LOGIN_DEFAULT_METHOD says, the mobile door is one tap away.
  await page.getByTestId("register-method-phone").click();
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByTestId("register-verify-cta").click();
  const form = page.getByTestId("register-verify-form");
  await expect(form).toHaveAttribute("data-step", "code", { timeout: 30_000 });
  // The code field is the SAME label /login uses.
  await page.getByLabel("6-digit code").fill(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();

  // Signed in, on the same URL (ref intact), and the wizard carries on with
  // the verify step ticked — not renumbered from 1.
  await expect(page.getByTestId("register-step-profile")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`${season.path}\\?ref=whatsapp$`));
  await expect(progress).toContainText("Verified");
  await expect(progress.locator(".is-done")).toHaveCount(1);

  await page.getByLabel("Your name").fill("Inline Player");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: "Batter", exact: true }).check();
  await page.getByTestId("register-continue").click();
  await page.getByTestId("register-consent").check();
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("registration-submitted")).toBeVisible({ timeout: 30_000 });

  expect(
    visited.filter((url) => new URL(url).pathname.startsWith("/login")),
    visited.join("\n"),
  ).toEqual([]);
  expect(
    visited.filter((url) => new URL(url).pathname.startsWith("/onboarding")),
    visited.join("\n"),
  ).toEqual([]);

  // A reload is the status view, never a second form.
  await page.reload();
  await expect(page.getByTestId("my-registration-status")).toHaveText("submitted");
});

test("a wrong code is refused in place, and the right one still gets through", async ({ page }) => {
  test.setTimeout(90_000);
  const phone = `66${STAMP}`;
  await page.goto(season.path);
  await page.getByTestId("register-method-phone").click();
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByTestId("register-verify-cta").click();
  await expect(page.getByTestId("register-verify-form")).toHaveAttribute("data-step", "code", {
    timeout: 30_000,
  });
  const code = await latestOtp(phone);
  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByLabel("6-digit code").fill(wrong);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByText(/isn't right/)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`${season.path}$`));

  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByTestId("register-step-profile")).toBeVisible({ timeout: 30_000 });
});

test("the email door verifies inline, then the wizard collects the mobile", async ({ page }) => {
  test.setTimeout(120_000);
  const address = `inline${STAMP}@example.test`;
  const phone = `67${STAMP}`;
  const visited = recordNavigations(page);

  await page.goto(season.path);
  await page.getByTestId("register-method-email").click();
  // Said up front: an email account still owes a mobile, as a step of its own.
  await expect(page.getByRole("list", { name: "Registration progress" })).toContainText("Mobile");
  await page.getByTestId("email-login-address").fill(address);
  await page.getByTestId("register-verify-cta").click();
  await expect(page.getByTestId("email-login-code")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("email-login-code").fill(await latestOtp(address));
  await page.getByTestId("email-login-verify").click();

  await expect(page.getByTestId("register-step-mobile")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByTestId("register-phone-send").click();
  await page.getByLabel("Six-digit code").fill(await latestOtp(phone));
  await page.getByTestId("register-phone-confirm").click();
  await expect(page.getByTestId("register-step-profile")).toBeVisible({ timeout: 30_000 });

  expect(
    visited.filter((url) => new URL(url).pathname.startsWith("/login")),
    visited.join("\n"),
  ).toEqual([]);
});
