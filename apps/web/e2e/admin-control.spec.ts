import { expect, test, type Page } from "@playwright/test";

import { createDb, grants, newId, people, sessions } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { latestOtp } from "./otp";

/*
 * AC-1.2, END TO END: a superadmin suspends someone, proving it's them with a
 * fresh code; the person is out on their next click and cannot sign back in;
 * the suspension is lifted; a role is given and shows on /admin/roles.
 */

const STAMP = String(Date.now()).slice(-7);
const COLD = { timeout: 30_000 } as const;
// Ten-digit Indian mobiles, as typed on the sign-in form.
const SUPER = `9${STAMP}01`;
const TARGET = `9${STAMP}02`;

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
const owner = createDb(DATABASE_URL);

async function otpLogin(page: Page, phone: string, name: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", COLD);
  await page.getByLabel("6-digit code").clear();
  await page.getByLabel("6-digit code").pressSequentially(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).not.toHaveURL(/\/login/, COLD);
  if (page.url().includes("/onboarding")) {
    await page.getByLabel("What should we call you?").fill(name);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/home/);
  }
}

async function personId(phone: string): Promise<string> {
  const [row] = await owner.db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.phone, `+91${phone}`))
    .limit(1);
  if (row === undefined) {
    throw new Error(`no person for ${phone}`);
  }
  return row.id;
}

test.afterAll(async () => {
  await owner.sql.end();
});

test("a superadmin suspends, confirms it's them, lifts it, and gives a role", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const targetCtx = await browser.newContext();
  const target = await targetCtx.newPage();
  await otpLogin(target, TARGET, "Target Person");
  const superCtx = await browser.newContext();
  const admin = await superCtx.newPage();
  await otpLogin(admin, SUPER, "Super Admin");

  // The founder's two grants, the way seed:admin gives them.
  const superId = await personId(SUPER);
  for (const set of ["platform:admin", "platform:superadmin"]) {
    await owner.db.insert(grants).values({
      id: newId(),
      personId: superId,
      scopeType: "platform",
      scopeId: "00000000000000000000000000",
      capabilitySet: set,
      grantedBy: superId,
    });
  }
  // An afternoon-old session: signed in, but not confirmed in the last ten minutes.
  await owner.db.update(sessions).set({ steppedUpAt: null }).where(eq(sessions.personId, superId));

  const targetId = await personId(TARGET);
  await admin.goto(`/admin/people/${targetId}`);
  await expect(admin.getByTestId("admin-account")).toContainText("Open", COLD);

  // --- Suspend: reason, then "Confirm it's you" with a fresh code ------------
  await admin.getByTestId("admin-suspend").click();
  await admin.getByTestId("admin-reason").fill("Reported for abusive messages in a club chat");
  await admin.getByTestId("admin-confirm").click();
  await expect(admin.getByRole("dialog", { name: "Confirm it's you" })).toBeVisible(COLD);
  await admin.getByTestId("step-up-code").fill(await latestOtp(SUPER));
  await admin.getByTestId("step-up-confirm").click();
  await expect(admin.getByText(/is suspended and was signed out/)).toBeVisible(COLD);
  await expect(admin.getByTestId("admin-suspension")).toContainText(
    "Reported for abusive messages",
  );

  // --- The person is out on their next click, and sign-in refuses them -------
  await target.goto("/home");
  await expect(target).toHaveURL(/\/login/, COLD);
  await target.getByLabel("Mobile number").fill(TARGET);
  await target.getByRole("button", { name: "Send code" }).click();
  await expect(target.getByTestId("login-form")).toHaveAttribute("data-step", "code", COLD);
  await target.getByLabel("6-digit code").pressSequentially(await latestOtp(TARGET));
  await target.getByRole("button", { name: "Verify and continue" }).click();
  await expect(target.getByText(/This account is suspended/)).toBeVisible(COLD);

  // --- Lifted: no second code, the step-up still covers it ------------------
  await admin.getByTestId("admin-unsuspend").click();
  await admin.getByTestId("admin-reason").fill("Reviewed with the club; the report was mistaken");
  await admin.getByTestId("admin-confirm").click();
  await expect(admin.getByText(/can sign in again/)).toBeVisible(COLD);
  await expect(admin.getByRole("dialog", { name: "Confirm it's you" })).toHaveCount(0);

  // --- A role, and the roles page says who holds it -------------------------
  await admin.getByTestId("admin-give-role").click();
  await admin.getByTestId("admin-role-select").selectOption("platform:support");
  await admin.getByTestId("admin-reason").fill("Helping with problem reports this month");
  await admin.getByTestId("admin-confirm").click();
  await expect(admin.getByText(/now has Support desk/)).toBeVisible(COLD);
  await admin.goto("/admin/roles");
  await expect(admin.getByTestId("admin-role-platform:support")).toContainText(
    "Target Person",
    COLD,
  );

  await targetCtx.close();
  await superCtx.close();
});
