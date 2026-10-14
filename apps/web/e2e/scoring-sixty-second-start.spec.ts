import { expect, test } from "@playwright/test";
import { scoringSession, seedScoringFixture, sent } from "./scoring-fixtures";

/**
 * X-20 · THE 60-SECOND START.
 *
 * The promise to a scorer at the ground: from the scorer home to the first
 * ball on the pad in under a minute, on a season the club already set up. The
 * clock runs from opening /score to the first delivery being accepted by the
 * server, through the real setup screens. A Playwright trace of the run is
 * attached so the time can be read step by step, not just as one number.
 */
test("X-20 a scorer gets from /score to an accepted first ball inside 60 seconds", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const fixture = await seedScoringFixture();
  await scoringSession(page.context(), fixture.actorToken);
  await page.context().tracing.start({ screenshots: true, snapshots: true, title: "X-20" });
  const marks: Record<string, number> = {};
  const started = Date.now();
  const mark = (name: string) => {
    marks[name] = Date.now() - started;
  };
  try {
    await page.goto("/score");
    await page.locator(`a[href="/score/${fixture.fixtureId}/setup"]`).first().click();
    await page.waitForURL(`**/score/${fixture.fixtureId}/setup`);
    mark("setup open");
    await page.getByRole("button", { name: "Looks right Confirm conditions", exact: true }).click();
    await page.getByRole("button", { name: "Both XIs ready Next: toss", exact: true }).click();
    await page.getByTestId("setup-start").click();
    await page.waitForURL(`**/score/${fixture.fixtureId}`);
    await expect(page.getByTestId("pad-run-0")).toBeEnabled();
    mark("pad ready");
    await page.getByTestId("pad-run-1").click();
    await sent(page);
    mark("first ball accepted");
  } finally {
    const trace = info.outputPath("x20-trace.zip");
    await page.context().tracing.stop({ path: trace });
    await info.attach("x20-trace", { path: trace, contentType: "application/zip" });
  }
  const total = marks["first ball accepted"] ?? Number.POSITIVE_INFINITY;
  info.annotations.push({ type: "x20", description: JSON.stringify(marks) });
  console.log(`X-20 60-second start: ${JSON.stringify(marks)}`);
  expect(total).toBeLessThan(60_000);
});
