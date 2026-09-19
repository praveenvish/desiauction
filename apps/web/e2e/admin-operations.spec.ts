import AxeBuilder from "@axe-core/playwright";
import { competitions, createDb, grants, newId, organizations, people } from "@desiauction/db";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";

import { latestOtp, resetOtpBudget, withSignInLock } from "./otp";

// ADMIN OPERATIONS — the live board, the auction watch and the moderation desk,
// through the browser.
//
// What is proved here is what a browser can prove: the pages exist for the
// people who hold the grant and are real 404s for everyone else; the live board
// and the watch render the demo's own auctions; a public season can be taken
// down and its public page is then gone; the desks fit a phone and pass axe.
// The data claims (counts, recency, the CHECK that keeps a held season private,
// the writes as the production roles) are proved against Postgres in
// live-views.regression.test.ts and platform-desks.posture.test.ts.

test.describe.configure({ mode: "serial" });

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
// The demo seed's fixed identities (seed-demo.ts):
//   founder +919999000001 — platform:admin (this spec lends platform:moderation)
//   admin   +919999000002 — org:owner on demo-club, holds no platform grant
const FOUNDER = "9999000001";
const ORG_OWNER = "9999000002";
const STAMP = String(Date.now()).slice(-8);
const SEASON_NAME = `Moderation Target ${STAMP}`;
const REASON = "Season name breaks the community guidelines";

let grantId = "";
let orgId = "";
let seasonSlug = "";

async function otpLogin(page: Page, phone: string): Promise<void> {
  // Serialized per phone across workers: see withSignInLock in otp.ts.
  await withSignInLock(phone, async () => {
    await resetOtpBudget(phone);
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill(phone);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code", {
      timeout: 30_000,
    });
    await page.getByLabel("6-digit code").fill(await latestOtp(phone));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });
}

async function axeClean(page: Page, surface: string): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations, `${surface}: ${JSON.stringify(scan.violations, null, 2)}`).toEqual([]);
}

test.beforeAll(async () => {
  const handle = createDb(DATABASE_URL);
  const [founder] = await handle.db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.phone, `+91${FOUNDER}`))
    .limit(1);
  if (founder === undefined) {
    throw new Error("the demo seed is missing the founder — run pnpm seed:demo");
  }
  // Lent out of band, the only way a platform grant can be installed.
  grantId = newId();
  await handle.db.insert(grants).values({
    id: grantId,
    personId: founder.id,
    scopeType: "platform",
    scopeId: "00000000000000000000000000",
    capabilitySet: "platform:moderation",
    grantedBy: founder.id,
  });
  // A throwaway public season in a throwaway club — the demo's own seasons
  // stay untouched.
  orgId = newId();
  const seasonId = newId();
  seasonSlug = `moderation-target-${STAMP}`;
  await handle.db.insert(organizations).values({
    id: orgId,
    name: `Moderation Club ${STAMP}`,
    slug: `moderation-club-${STAMP}`,
    createdBy: founder.id,
  });
  await handle.db.insert(competitions).values({
    id: seasonId,
    orgId,
    sport: "cricket",
    name: SEASON_NAME,
    slug: seasonSlug,
    status: "registration_open",
    visibility: "public",
    location: "Powai",
    startsOn: "2026-12-01",
    endsOn: "2026-12-20",
    createdBy: founder.id,
  });
  await handle.sql.end();
});

test.afterAll(async () => {
  const handle = createDb(DATABASE_URL);
  await handle.db.delete(grants).where(eq(grants.id, grantId));
  if (orgId !== "") {
    await handle.db.delete(competitions).where(eq(competitions.orgId, orgId));
    await handle.db.delete(organizations).where(inArray(organizations.id, [orgId]));
  }
  await handle.sql.end();
});

test("the overview leads with what is live, and the live board shows every room", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await otpLogin(page, FOUNDER);

  await page.goto("/admin");
  await expect(page.getByTestId("admin-live-now")).toBeVisible();
  await page.getByTestId("admin-live-board-link").click();
  await expect(page).toHaveURL(/\/admin\/live$/);

  await expect(page.getByRole("heading", { name: "Live", level: 1 })).toBeVisible();
  await expect(page.getByTestId("live-summary")).toBeVisible();
  await expect(page.getByTestId("live-running")).toBeVisible();
  await expect(page.getByTestId("live-freshness")).toContainText("Refreshing automatically");
  await axeClean(page, "/admin/live");
});

test("the auction watch opens from the club, and reads as the report once closed", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await otpLogin(page, FOUNDER);

  await page.goto("/admin/orgs/demo-club");
  // The settled demo cup's auction badge is the way in.
  await page
    .getByRole("link", { name: /Watch this auction/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/auctions\/[0-9A-Z]{26}$/);
  await expect(page.getByTestId("auction-watch-head")).toBeVisible();
  await expect(page.getByTestId("auction-watch-vitals")).toBeVisible();
  await expect(page.getByTestId("auction-watch-lots")).toBeVisible();
  await expect(page.getByTestId("auction-watch-teams")).toBeVisible();
  // Watching carries no way to act: no buttons that post, no conduct controls.
  await expect(page.locator('form[method="post"]')).toHaveCount(0);
  await axeClean(page, "/admin/auctions/[id]");

  // A malformed or unknown id is a real 404, not a 200 saying "not found".
  expect((await page.request.get("/admin/auctions/not-an-auction")).status()).toBe(404);
});

test("moderation: a public season is taken down, its page is gone, and the hold lifts", async ({
  page,
}) => {
  test.setTimeout(180_000);
  // The page is public before anything happens.
  expect((await page.request.get(`/c/${seasonSlug}`)).status()).toBe(200);

  await otpLogin(page, FOUNDER);
  await page.goto(`/admin/moderation?q=${encodeURIComponent(SEASON_NAME)}`);
  const row = page.getByTestId(`moderation-public-${seasonSlug}`);
  await expect(row).toBeVisible();
  await axeClean(page, "/admin/moderation");

  await page.getByTestId(`take-down-${seasonSlug}`).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // No reason, no take-down.
  await expect(dialog.getByTestId("take-down-confirm")).toBeDisabled();
  await dialog.getByLabel("Reason").fill(REASON);
  await dialog.getByTestId("take-down-confirm").click();
  await expect(page.getByText(/is off the public web/)).toBeVisible();

  const held = page.getByTestId(`moderation-held-${seasonSlug}`);
  await expect(held).toBeVisible();
  await expect(held).toContainText(REASON);
  // Gone from the open web.
  expect((await page.request.get(`/c/${seasonSlug}`)).status()).toBe(404);

  // Lifting hands the decision back; it does not republish.
  await page.getByTestId(`lift-hold-${seasonSlug}`).click();
  await page.getByRole("dialog").getByTestId("lift-hold-confirm").click();
  await expect(page.getByText(/stays unlisted until the organizer publishes/)).toBeVisible();
  await expect(page.getByTestId(`moderation-held-${seasonSlug}`)).toHaveCount(0);
  expect((await page.request.get(`/c/${seasonSlug}`)).status()).toBe(404);
});

test("the partition: an org owner reaches none of it", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, ORG_OWNER);
  for (const route of ["/admin/live", "/admin/moderation", "/admin/auctions/not-an-auction"]) {
    const response = await page.request.get(route);
    expect(response.status(), `${route} must 404 for a non-admin`).toBe(404);
  }
});

test("360px: the live board, the watch and the desk fit a phone", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await otpLogin(page, FOUNDER);
  await page.goto("/admin/orgs/demo-club");
  const watchHref = await page
    .getByRole("link", { name: /Watch this auction/ })
    .first()
    .getAttribute("href");
  for (const route of ["/admin", "/admin/live", "/admin/moderation", watchHref ?? "/admin/live"]) {
    await page.goto(route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} scrolls sideways at 360px`).toBeLessThanOrEqual(0);
  }
});
