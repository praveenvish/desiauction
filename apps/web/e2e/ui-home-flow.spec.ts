import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  createDb,
  competitions,
  grants,
  newId,
  registrations,
  teamManagers,
  people,
  sessions,
} from "@desiauction/db";
import { eq, and } from "drizzle-orm";
import {
  seedScoringFixture,
  scoringSession,
  followupScoringFixture,
  startScoring,
  runBall,
  readyOffline,
  persistedQueue,
  committedQueue,
} from "./scoring-fixtures";

const url = process.env["DATABASE_URL"];
if (!url || !url.includes("127.0.0.1:15437/ls1_c29_clean"))
  throw new Error("Isolated validation database required");

test("Home reflects actual scorer, manager, finance and support duties without promoting a captain", async ({
  page,
}, info) => {
  const fixture = await seedScoringFixture({ teamManaged: true });
  await followupScoringFixture(fixture, 2, { sameDay: true });
  const foreign = await seedScoringFixture();
  const handle = createDb(url, { max: 1 });
  try {
    const [season] = await handle.db
      .select()
      .from(competitions)
      .where(eq(competitions.slug, fixture.slug));
    if (!season) throw new Error("season");
    const captainRegistration = fixture.homePlayers[0];
    if (!captainRegistration) throw new Error("captain registration");
    await handle.db
      .update(registrations)
      .set({ personId: fixture.actorId, isCaptain: true })
      .where(eq(registrations.id, captainRegistration));
    await scoringSession(page.context(), fixture.actorToken);
    await page.goto("/home");
    await expect(page.getByTestId("home-match-responsibilities")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('[data-task^="score:"]')).toHaveCount(2);
    await expect(page.locator(`[data-task*="${foreign.fixtureId}"]`)).toHaveCount(0);
    await expect(page.locator('[data-task^="lineup:"]')).toHaveCount(0);
    await expect(page.getByTestId("home-finance-responsibilities")).toHaveCount(0);
    await expect(page.getByTestId("home-platform-responsibilities")).toHaveCount(0);
    // Current captain/manager assignment is real; removing it removes the role,
    // even though the fixture and its player captain designations still exist.
    await handle.db
      .update(teamManagers)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(teamManagers.personId, fixture.actorId), eq(teamManagers.competitionId, season.id)),
      );
    await page.reload();
    await expect(page.getByTestId("home-match-responsibilities")).toHaveCount(0);
    await handle.db.insert(grants).values([
      {
        id: newId(),
        personId: fixture.actorId,
        scopeType: "tournament",
        scopeId: season.id,
        capabilitySet: "fixture:scorer",
        grantedBy: fixture.actorId,
      },
      {
        id: newId(),
        personId: fixture.actorId,
        scopeType: "org",
        scopeId: season.orgId,
        capabilitySet: "finops:clerk",
        grantedBy: fixture.actorId,
      },
      {
        id: newId(),
        personId: fixture.actorId,
        scopeType: "platform",
        scopeId: "platform",
        capabilitySet: "platform:support",
        grantedBy: fixture.actorId,
      },
    ]);
    await page.reload();
    await expect(page.getByTestId("home-match-responsibilities")).toBeVisible();
    await expect(page.getByTestId("home-finance-responsibilities")).toBeVisible();
    // Platform singleton identity is deliberately read from the real engine below;
    // a malformed singleton grant must not decorate Home as an administrator.
    await expect(page.getByTestId("home-platform-responsibilities")).toHaveCount(0);
    await handle.db
      .update(grants)
      .set({ scopeId: "00000000000000000000000000" })
      .where(
        and(eq(grants.personId, fixture.actorId), eq(grants.capabilitySet, "platform:support")),
      );
    await page.reload();
    await expect(page.getByTestId("home-platform-responsibilities")).toBeVisible();
    await expect(
      page.getByTestId("home-platform-responsibilities").getByRole("link"),
    ).toHaveAttribute("href", "/admin/reports");
    await expect(
      page.getByTestId("home-platform-responsibilities").locator('a[href="/admin"]'),
    ).toHaveCount(0);
    for (const theme of ["daylight", "floodlight"]) {
      await page.evaluate(async (value) => {
        document.documentElement.setAttribute("data-theme", value);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        // Assess the settled theme, while preserving real production motion.
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation instanceof CSSTransition)
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      }, theme);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.screenshot({
          path: info.outputPath(`home-duties-${theme}-${String(width)}.png`),
          fullPage: true,
        });
      }
    }
    const href = await page
      .locator('[data-task^="score:"]')
      .first()
      .getByRole("link")
      .getAttribute("href");
    expect(href).toMatch(/^\/score\//);
    await page.locator('[data-task^="score:"]').first().getByRole("link").click();
    await expect(page).toHaveURL(href!);
    await page.goBack();
    await expect(page).toHaveURL(/\/home/);
    await expect(page.locator('[data-task^="score:"]')).toHaveCount(2);
  } finally {
    await handle.sql.end();
  }
});

test("sign-out stays cancellable before cleanup and clears queued data across open tabs only after confirmation", async ({
  page,
  context,
}) => {
  const fixture = await seedScoringFixture();
  await startScoring(page, fixture);
  await readyOffline(page, fixture.fixtureId);
  await context.setOffline(true);
  await runBall(page);
  await committedQueue(page, fixture.fixtureId, ["ball"]);
  const queued = await persistedQueue(page, fixture.fixtureId);
  expect(queued).toHaveLength(1);
  // Return online without allowing this tab to send, then use the account tab.
  await page.route("**/api/score/**", (route) => route.abort());
  await context.setOffline(false);
  const account = await context.newPage();
  await account.goto("/account");
  await account.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(account.getByRole("dialog")).toContainText("unsent scoring entries");
  await account.getByRole("button", { name: "Stay signed in" }).click();
  expect((await persistedQueue(page, fixture.fixtureId)).map((item) => item.event.eventId)).toEqual(
    queued.map((item) => item.event.eventId),
  );
  await account.getByRole("button", { name: "Sign out", exact: true }).click();
  await account.getByTestId("sign-out-confirm").click();
  await expect(account).toHaveURL(/\/(login|$)/);
  await expect.poll(async () => (await persistedQueue(page, fixture.fixtureId)).length).toBe(0);
  await page.unroute("**/api/score/**");
  await account.close();
});

test("sign-out keeps pending dismissal blocked and explains a failed session revoke before retry", async ({
  page,
}) => {
  const fixture = await seedScoringFixture();
  await scoringSession(page.context(), fixture.actorToken);
  await page.goto("/account");
  let release: (() => void) | undefined;
  await page.route("**/account", async (route) => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) {
      await route.continue();
      return;
    }
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByTestId("sign-out-confirm").click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(page.getByTestId("sign-out-confirm")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stay signed in" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  release!();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Some saved device entries may already have been cleared",
  );
  await expect(page.getByRole("button", { name: "Stay signed in" })).toBeEnabled();
  await page.unroute("**/account");
  await page.getByTestId("sign-out-confirm").click();
  await expect(page).toHaveURL(/\/(login|$)/);
});

test("an explicit Home start and season intent survives sign-in and first-name onboarding", async ({
  page,
}) => {
  const { latestOtp } = await import("./otp");
  const intent = "/home?start=club&season=remembered-season";
  await page.goto(intent);
  await expect(page).toHaveURL(/\/login/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(intent);
  const phone = `81${String(Date.now()).slice(-8)}`;
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByTestId("login-form")).toHaveAttribute("data-step", "code");
  await page.getByLabel("6-digit code").clear();
  await page.getByLabel("6-digit code").pressSequentially(await latestOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(intent);
  await page.getByLabel("What should we call you?").fill("Intent Tester");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(intent);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(intent);
});

for (const intent of [
  "/home?season=remembered-season",
  "/home?start=club&season=remembered-season",
]) {
  test(`email sign-in retains ${intent} through first-name onboarding`, async ({ page }) => {
    const fixture = await seedScoringFixture();
    const handle = createDb(url, { max: 1 });
    const email = `${fixture.actorId.toLowerCase()}@example.test`;
    try {
      await handle.db
        .update(people)
        .set({ name: null, email, emailVerifiedAt: new Date() })
        .where(eq(people.id, fixture.actorId));
      await page.goto(`/login?method=email&next=${encodeURIComponent(intent)}`);
      await page.getByTestId("email-login-address").fill(email);
      await page.getByTestId("email-login-send").click();
      await expect(page.getByTestId("email-login-code")).toBeVisible();
      const { latestOtp } = await import("./otp");
      await page.getByTestId("email-login-code").clear();
      await page.getByTestId("email-login-code").pressSequentially(await latestOtp(email));
      await page.getByTestId("email-login-verify").click();
      await expect(page).toHaveURL(/\/onboarding/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(intent);
      await page.getByLabel("What should we call you?").fill("Email Intent Tester");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page).toHaveURL(intent);
    } finally {
      await handle.sql.end();
    }
  });
}

for (const expiry of ["before render", "before submit"] as const) {
  test(`onboarding retains its nested destination when the session expires ${expiry}`, async ({
    page,
  }) => {
    const fixture = await seedScoringFixture();
    const handle = createDb(url, { max: 1 });
    const intent = "/home?start=club&season=remembered-season";
    const onboarding = `/onboarding?next=${encodeURIComponent(intent)}`;
    try {
      await handle.db.update(people).set({ name: " " }).where(eq(people.id, fixture.actorId));
      await scoringSession(page.context(), fixture.actorToken);
      if (expiry === "before submit") {
        await page.goto(intent);
        await expect(page).toHaveURL(onboarding);
        await expect(page.getByTestId("home-match-responsibilities")).toHaveCount(0);
        await page.getByLabel("What should we call you?").fill("Recovered Tester");
      }
      await handle.db
        .update(sessions)
        .set({ expiresAt: new Date(0) })
        .where(
          eq(sessions.tokenHash, createHash("sha256").update(fixture.actorToken).digest("hex")),
        );
      if (expiry === "before submit")
        await page.getByRole("button", { name: "Continue", exact: true }).click();
      else await page.goto(onboarding);
      await expect(page).toHaveURL(/\/login/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(onboarding);
      // The login return is itself validated; a fresh session resumes the same form.
      await handle.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() + 3600000) })
        .where(
          eq(sessions.tokenHash, createHash("sha256").update(fixture.actorToken).digest("hex")),
        );
      await scoringSession(page.context(), fixture.actorToken);
      await page.goto(onboarding);
      await page.getByLabel("What should we call you?").fill("Recovered Tester");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page).toHaveURL(intent);
    } finally {
      await handle.sql.end();
    }
  });
}

test("repeated onboarding next values fall back safely for anonymous and nameless accounts", async ({
  page,
}) => {
  await page.goto("/onboarding?next=/home&next=/home");
  await expect(page).toHaveURL(/\/login/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/onboarding");
  const fixture = await seedScoringFixture();
  const handle = createDb(url, { max: 1 });
  try {
    await handle.db.update(people).set({ name: null }).where(eq(people.id, fixture.actorId));
    await scoringSession(page.context(), fixture.actorToken);
    await page.goto("/onboarding?next=/home&next=/home");
    await expect(page.getByLabel("What should we call you?")).toBeVisible();
    await page.getByLabel("What should we call you?").fill("Safe Default Tester");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL("/home");
  } finally {
    await handle.sql.end();
  }
});
