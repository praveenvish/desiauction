import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createDb, people, registrations, auditLog, fixtures } from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";
import { seedScoringFixture, scoringSession } from "./scoring-fixtures";

test("a guest mobile-link retry keeps one registration and sends only the recipient an inbox notice", async ({
  page,
  browser,
}) => {
  const fixture = await seedScoringFixture();
  const phone = `+9160${String(Date.now()).slice(-8)}`;
  const handle = createDb(process.env["DATABASE_URL"]!, { max: 1 });
  const recipient = await browser.newContext({ baseURL: "http://localhost:3050" });
  try {
    await handle.db.update(people).set({ phone }).where(eq(people.id, fixture.nextActorId));
    await scoringSession(page.context(), fixture.actorToken);
    await page.goto(`/score/${fixture.fixtureId}/setup`);
    await page.getByRole("button", { name: "Looks right Confirm conditions", exact: true }).click();
    await page.getByRole("button", { name: "+ Add player", exact: true }).first().click();
    const form = page.locator("form.score-guest");
    await form.getByLabel("Player name", { exact: true }).fill("Claim retry guest");
    await form.getByLabel("Mobile number (optional)", { exact: true }).fill("123");
    await form.getByRole("button", { name: "Add player", exact: true }).click();
    await expect(
      form.getByRole("button", { name: "Link mobile number", exact: true }),
    ).toBeVisible();
    await expect(form.getByLabel("Player name", { exact: true })).toBeDisabled();
    await expect(
      form.getByRole("button", { name: "Link mobile number", exact: true }),
    ).toBeEnabled();
    for (const theme of ["daylight", "floodlight"]) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: test.info().outputPath(`guest-claim-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    const [match] = await handle.db
      .select()
      .from(fixtures)
      .where(eq(fixtures.id, fixture.fixtureId));
    if (!match) throw new Error("Missing fixture");
    const guests = () =>
      handle.db
        .select({ id: registrations.id, personId: registrations.personId })
        .from(registrations)
        .innerJoin(people, eq(people.id, registrations.personId))
        .where(
          and(
            eq(registrations.competitionId, match.competitionId),
            sql`coalesce(${registrations.enteredName}, ${people.name}) = ${"Claim retry guest"}`,
          ),
        );
    const before = await guests();
    expect(before).toHaveLength(1);
    await form.getByLabel("Mobile number (optional)", { exact: true }).fill(phone);
    await form.getByRole("button", { name: "Link mobile number", exact: true }).click();
    await expect(form).toHaveCount(0);
    const after = await guests();
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.personId).toBe(fixture.nextActorId);
    const notices = await handle.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.scopeId, fixture.nextActorId), eq(auditLog.action, "player.claim_invited")),
      );
    expect(notices).toHaveLength(1);
    await page.goto("/inbox");
    await expect(page.getByText("Sign in to see your match stats", { exact: true })).toHaveCount(0);
    await scoringSession(recipient, fixture.nextActorToken);
    const other = await recipient.newPage();
    await other.goto("/inbox");
    await expect(other.getByText("Sign in to see your match stats", { exact: true })).toBeVisible();
  } finally {
    await recipient.close();
    await handle.sql.end({ timeout: 5 });
  }
});
