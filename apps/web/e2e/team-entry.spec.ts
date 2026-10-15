import { createHash, randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { competitions, createDb, fixtures, newId, people, sessions } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { scoringSession, runBall, sent, readScoringFixture } from "./scoring-fixtures";

async function formationScreens(page: import("@playwright/test").Page, name: string) {
  for (const theme of ["daylight", "floodlight"]) {
    await page.evaluate(async (value) => {
      document.documentElement.setAttribute("data-theme", value);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await Promise.all(
        document
          .getAnimations()
          .filter((item) => item instanceof CSSTransition)
          .map((item) => item.finished.catch(() => undefined)),
      );
    }, theme);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: test.info().outputPath(`${name}-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
}

test("organizer creates team sign-ups, captain submits, approval builds squads and a generated match scores an over", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const handle = createDb(process.env["DATABASE_URL"]!, { max: 1 });
  const captainContext = await browser.newContext({ baseURL: "http://localhost:3050" });
  const captainPage = await captainContext.newPage();
  const organizerId = newId(),
    captainId = newId(),
    stamp = newId().slice(-6);
  const organizerToken = randomBytes(32).toString("base64url"),
    captainToken = randomBytes(32).toString("base64url");
  try {
    for (const [id, token, name] of [
      [organizerId, organizerToken, "Entry organizer"],
      [captainId, captainToken, "Entry captain"],
    ]) {
      await handle.db.insert(people).values({ id: id!, name: name!, email: `${id}@example.test` });
      await handle.db.insert(sessions).values({
        id: newId(),
        personId: id!,
        tokenHash: createHash("sha256").update(token!).digest("hex"),
        expiresAt: new Date(Date.now() + 3600000),
      });
    }
    await scoringSession(page.context(), organizerToken);
    await scoringSession(captainContext, captainToken);
    await page.goto("/orgs");
    await page.getByTestId("new-org").click();
    await page.getByLabel("Club name").filter({ visible: true }).fill(`Entry club ${stamp}`);
    await page.getByRole("button", { name: "Create club" }).click();
    await expect(page.getByTestId("org-name")).toBeVisible();
    await page.getByRole("tab", { name: "Venues" }).click();
    await expect(page.getByTestId("venues-panel")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Venue name").fill("Entry ground");
    await page.getByLabel("City").fill("Mumbai");
    await page.getByTestId("add-venue").click();
    await expect(page.getByTestId("venue-name")).toHaveText("Entry ground");
    await page.getByRole("button", { name: "Add a ground" }).click();
    await page.getByLabel("Ground name").fill("Entry oval");
    await page.getByTestId("add-ground").click();
    await expect(
      page.getByTestId("venues-panel").getByText("Entry oval", { exact: true }),
    ).toBeVisible();
    await page.goto("/seasons");
    await page.getByTestId("new-season").click();
    await page.getByLabel("Season name").filter({ visible: true }).fill(`Entry cup ${stamp}`);
    await page.getByLabel("Location").fill("Mumbai");
    await page.getByLabel("Starts on").fill("2026-10-10");
    await page.getByLabel("Ends on").fill("2026-11-30");
    await page.getByLabel("Sport").selectOption("box_cricket");
    await page.getByLabel("How will teams be formed?").selectOption("team_entry");
    await expect(page.getByLabel("Auction currency")).toHaveCount(0);
    await formationScreens(page, "team-formation");
    await page.getByRole("button", { name: "Create season", exact: true }).click();
    await expect(page.getByTestId("competition-status")).toHaveText("draft");
    const base = page.url();
    const slug = new URL(base).pathname.split("/").at(-1)!;
    await expect(page.getByTestId("open-auction")).toHaveCount(0);
    await page.getByTestId("advance-status").click();
    await expect(page.getByTestId("competition-status")).toHaveText("setup");
    await page.getByTestId("advance-status").click();
    await expect(page.getByTestId("competition-status")).toHaveText("registration open");
    await page.goto(`${base}/teams`);
    const link = await page
      .getByRole("link", { name: "Open captain sign-up", exact: true })
      .getAttribute("href");
    expect(link).toMatch(/^\/join\/[A-HJ-NP-Z2-9]{6}$/);
    for (const side of ["Entry Smashers", "Entry Panthers"]) {
      const joinResponse = await captainPage.goto(link!);
      await expect(
        captainPage.getByRole("heading", { name: `Join Entry cup ${stamp}` }),
      ).toBeVisible();
      expect(joinResponse?.headers()["x-robots-tag"]).toContain("noindex");
      await captainPage.getByLabel("Team name").fill(side);
      for (let index = 0; index < 6; index++) {
        if (index > 0)
          await captainPage.getByRole("button", { name: "Add player", exact: true }).click();
        await captainPage
          .getByLabel(`Player ${String(index + 1)} name`)
          .fill(`${side} player ${String(index + 1)}`);
      }
      if (side === "Entry Smashers") {
        for (const theme of ["daylight", "floodlight"]) {
          await captainPage.evaluate(
            (value) => document.documentElement.setAttribute("data-theme", value),
            theme,
          );
          for (const width of [390, 1440]) {
            await captainPage.setViewportSize({ width, height: 900 });
            expect((await new AxeBuilder({ page: captainPage }).analyze()).violations).toEqual([]);
            expect(
              await captainPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            ).toBe(true);
            await captainPage.screenshot({
              path: test.info().outputPath(`team-entry-${theme}-${width}.png`),
              fullPage: true,
            });
          }
        }
      }
      await captainPage.getByRole("button", { name: "Submit team", exact: true }).click();
      await expect(captainPage.getByRole("status")).toContainText("Your team has been submitted");
      await page.reload();
      if (side === "Entry Smashers") await formationScreens(page, "team-entry-review");
      await page.getByRole("button", { name: `Approve ${side}`, exact: true }).click();
      await expect(page.getByRole("button", { name: `Approve ${side}`, exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByTestId("teams-list")).toContainText(side);
    }
    await page.goto(base);
    await page.getByTestId("advance-status").click();
    await expect(page.getByTestId("competition-status")).toHaveText("season on");
    await page.goto(`${base}/fixtures`);
    await expect(page.getByTestId("stat-row")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Start date").fill(new Date().toISOString().slice(0, 10));
    await page.getByRole("radio", { name: "My own kickoff times" }).check();
    await page.getByLabel("Kickoff times", { exact: true }).fill("18:00");
    await page.getByRole("checkbox", { name: /Entry oval/ }).check();
    await page.getByTestId("generate-fixtures").click();
    await expect(page.getByTestId("generate-preview")).toContainText("1 fixture");
    await page.getByTestId("confirm-generate").click();
    await expect(page.getByTestId("stat-total")).toContainText("1");
    await page.getByTestId("schedule-all").click();
    await expect(page.getByTestId("stat-scheduled")).toContainText("1");
    await page.getByTestId("publish-all").click();
    await expect(page.getByTestId("stat-published")).toContainText("1");
    const [season] = await handle.db.select().from(competitions).where(eq(competitions.slug, slug));
    const [fixture] = await handle.db
      .select()
      .from(fixtures)
      .where(eq(fixtures.competitionId, season!.id));
    await page.goto(`/score/${fixture!.id}/setup`);
    await page.getByRole("button", { name: "Looks right Confirm conditions", exact: true }).click();
    for (const side of ["Entry Smashers", "Entry Panthers"]) {
      await page.getByRole("tab", { name: new RegExp(side) }).click();
      const squad = page.getByRole("tabpanel", { name: new RegExp(side) });
      await expect(squad.locator(".score-player-list")).toContainText(`${side} player 1`);
      await expect(squad.locator(".score-player-list .score-player-row")).toHaveCount(6);
    }
    await page.getByRole("button", { name: "Both XIs ready Next: toss", exact: true }).click();
    await page.getByTestId("setup-start").click();
    await page.waitForURL(`**/score/${fixture!.id}`);
    // Every new club-only opener/bowler uses the real style confirmation.
    for (let index = 0; index < 3; index++) {
      const dialog = page
        .getByRole("dialog")
        .filter({ has: page.getByRole("button", { name: "Save style", exact: true }) });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Save style", exact: true }).click();
    }
    for (let ball = 0; ball < 6; ball++) await runBall(page, 0);
    await sent(page);
    expect(
      (await readScoringFixture(fixture!.id)).events.filter((event) => event.type === "ball"),
    ).toHaveLength(6);
  } finally {
    await captainContext.close();
    await handle.sql.end({ timeout: 5 });
  }
});

test("legacy club invitations retain account switching, acceptance and generic expired or revoked failures", async ({
  page,
  browser,
}) => {
  const { createOrg } = await import("../src/server/orgs/orgs");
  const { createInvite } = await import("../src/server/orgs/invites");
  const { invites } = await import("@desiauction/db");
  const handle = createDb(process.env["DATABASE_URL"]!, { max: 1 });
  const second = await browser.newContext({ baseURL: "http://localhost:3050" });
  const reader = await second.newPage();
  const organizerId = newId(),
    memberId = newId();
  const organizerToken = randomBytes(32).toString("base64url"),
    memberToken = randomBytes(32).toString("base64url");
  try {
    for (const [id, token, name] of [
      [organizerId, organizerToken, "Legacy founder"],
      [memberId, memberToken, "Legacy invitee"],
    ]) {
      await handle.db.insert(people).values({ id: id!, name: name!, email: `${id}@example.test` });
      await handle.db.insert(sessions).values({
        id: newId(),
        personId: id!,
        tokenHash: createHash("sha256").update(token!).digest("hex"),
        expiresAt: new Date(Date.now() + 3600000),
      });
    }
    const org = await createOrg(handle.db, organizerId, `Legacy invite ${newId()}`);
    const valid = await createInvite(handle.db, org.id, organizerId, "org:staff");
    expect(valid.token).toHaveLength(32);
    await scoringSession(page.context(), organizerToken);
    await page.goto(`/join/${valid.token}`);
    await expect(page.getByTestId("join-card")).toContainText(org.name);
    await page.getByTestId("join-switch-account").click();
    await page.getByTestId("sign-out-confirm").click();
    await expect(page).toHaveURL(new RegExp(`/login\\?next=.*${valid.token}`));
    await scoringSession(second, memberToken);
    await reader.goto(`/join/${valid.token}`);
    await expect(reader.getByTestId("join-card")).toContainText(org.name);
    await reader.getByTestId("accept-invite").click();
    await expect(reader.getByTestId("org-name")).toHaveText(org.name);
    await reader.goto(`/join/${valid.token}`);
    await expect(reader.getByTestId("join-already-member")).toBeVisible();
    const expired = await createInvite(handle.db, org.id, organizerId, "org:staff");
    await handle.db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.tokenHash, createHash("sha256").update(expired.token).digest("hex")));
    const revoked = await createInvite(handle.db, org.id, organizerId, "org:staff");
    await handle.db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(eq(invites.tokenHash, createHash("sha256").update(revoked.token).digest("hex")));
    for (const token of [expired.token, revoked.token, randomBytes(24).toString("base64url")]) {
      await reader.goto(`/join/${token}`);
      await expect(reader.getByText(/This invite link is no longer valid/)).toBeVisible();
      await expect(reader.getByTestId("accept-invite")).toHaveCount(0);
    }
  } finally {
    await second.close();
    await handle.sql.end({ timeout: 5 });
  }
});
