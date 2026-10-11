import { createHash, randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { createDb, newId, people, sessions, matches } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { scoringSession, runBall, nextBowler, sent, readScoringFixture } from "./scoring-fixtures";

test("a personal quick match scores two overs, finishes and opens signed out by share link", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const handle = createDb(process.env["DATABASE_URL"]!, { max: 1 });
  const actorId = newId(),
    token = randomBytes(32).toString("base64url");
  const viewerContext = await browser.newContext({ baseURL: "http://localhost:3050" });
  try {
    await handle.db
      .insert(people)
      .values({ id: actorId, name: "Sunday scorer", email: `${actorId}@example.test` });
    await handle.db.insert(sessions).values({
      id: newId(),
      personId: actorId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600000),
    });
    await scoringSession(page.context(), token);
    await page.goto("/score");
    await page.getByRole("link", { name: "Quick match", exact: true }).click();
    await expect(page).toHaveURL(/\/score\/new$/);
    await page.getByLabel("Your team", { exact: true }).fill("Sunday Smashers");
    await page.getByLabel("Opponent", { exact: true }).fill("Panthers");
    await page.getByRole("button", { name: "Box six", exact: true }).click();
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
          path: test.info().outputPath(`quick-match-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await page.getByRole("button", { name: "Next: pick players", exact: true }).click();
    await page.waitForURL(/\/score\/[0-9A-Z]{26}\/setup$/);
    const fixtureId = page.url().split("/").at(-2)!;
    await page.getByRole("button", { name: "Looks right Confirm conditions", exact: true }).click();
    for (const [side, label] of ["Sunday Smashers", "Panthers"].entries()) {
      await page.getByRole("tab", { name: new RegExp(label) }).click();
      for (let index = 0; index < 6; index++) {
        await page.getByRole("button", { name: "+ Add player", exact: true }).click();
        const form = page.locator("form.score-guest");
        await form
          .getByLabel("Player name", { exact: true })
          .fill(`${side === 0 ? "Smash" : "Panther"} player ${index + 1}`);
        await form.getByRole("button", { name: "Add player", exact: true }).click();
        await expect(form).toHaveCount(0);
      }
    }
    await page.getByRole("button", { name: "Both XIs ready Next: toss", exact: true }).click();
    await page.getByTestId("setup-start").click();
    await page.waitForURL(`**/score/${fixtureId}`);
    await expect(page.getByTestId("pad-run-0")).toBeEnabled();
    for (const name of ["Smash player 1", "Smash player 2"]) {
      const style = page.getByRole("dialog", { name: `${name} · Which hand?`, exact: true });
      await expect(style).toBeVisible();
      await style.getByRole("button", { name: "Save style", exact: true }).click();
    }
    const saveBowlingStyle = async (name: string) => {
      const style = page.getByRole("dialog", {
        name: `${name} · First over · bowling style`,
        exact: true,
      });
      await expect(style).toBeVisible();
      await style.getByRole("button", { name: "Save style", exact: true }).click();
    };
    await saveBowlingStyle("Panther player 1");
    for (let ball = 0; ball < 6; ball++) await runBall(page, 0);
    await nextBowler(page, "Panther player 2");
    await saveBowlingStyle("Panther player 2");
    for (let ball = 0; ball < 6; ball++) await runBall(page, 0);
    await nextBowler(page, "Panther player 3");
    await saveBowlingStyle("Panther player 3");
    await sent(page);
    const before = await readScoringFixture(fixtureId);
    expect(before.events.filter((event) => event.type === "ball")).toHaveLength(12);
    await page.getByTestId("pad-menu").click();
    await page.getByTestId("menu-no-result").click();
    await page.getByLabel("Reason · required", { exact: true }).fill("Rain ended this friendly");
    await page.getByRole("button", { name: "Confirm no result", exact: true }).click();
    await page.getByTestId("finish-confirm").click();
    await sent(page);
    const saved = await readScoringFixture(fixtureId);
    expect(saved.match?.phase).toBe("no_result");
    expect(saved.match?.finishedAt).not.toBeNull();
    expect(saved.events.filter((event) => event.type === "finish")).toHaveLength(1);
    expect(saved.result?.source).toBe("scored");
    expect(saved.match?.trustLevel).not.toBe("verified");
    const [match] = await handle.db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
    expect(match?.shareToken).toBeTruthy();
    const viewer = await viewerContext.newPage();
    // The default personal-match delay remains real; never age database timestamps.
    await expect
      .poll(
        async () => {
          await viewer.goto(`/m/${match!.shareToken}`);
          return viewer.getByText("No result", { exact: true }).first().isVisible();
        },
        { timeout: 90_000, intervals: [2000] },
      )
      .toBe(true);
    await expect(viewer.getByText("Sunday Smashers", { exact: true }).first()).toBeVisible();
    expect(await viewer.locator('meta[name="robots"]').getAttribute("content")).toContain(
      "noindex",
    );
    await page.goto("/orgs");
    await expect(page.getByText("Sunday scorer's matches", { exact: true })).toHaveCount(0);
  } finally {
    await viewerContext.close();
    await handle.sql.end({ timeout: 5 });
  }
});
