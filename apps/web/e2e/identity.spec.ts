import { expect, test } from "@playwright/test";

/*
 * THE COMPONENT GALLERY IS A DEV TOOL, AND STAYS ONE.
 *
 * `/gallery` is deliberately absent from a production build — it is a
 * design-system showcase, not a product surface, and shipping it would widen
 * the public attack surface for nobody's benefit. That is correct, and it means
 * these specs cannot run against a precompiled (`next start`) server: at the
 * audit they were 23 of the 41 red tests, which made the suite impossible to
 * get green in the very mode that exists to stop the dev compiler exhausting
 * its heap.
 *
 * Skipping when the route is structurally absent is the honest answer. The dev
 * run still covers them, and CI runs them there.
 */
const GALLERY_IS_ABSENT = process.env["PLAYWRIGHT_PRECOMPILED"] === "1";
test.skip(GALLERY_IS_ABSENT, "/gallery is dev-only; run this suite against `next dev`");

// M-IP1-3 verification: determinism in a real browser, failure recovery,
// zero-CLS construction, and the wall itself. Axe + 360px coverage comes from
// the page-wide suites, which now include this section automatically.

test.beforeEach(async ({ page }) => {
  await page.goto("/gallery");
  await expect(page.getByTestId("identity-wall")).toBeVisible();
});

test("the wall renders 20 marks with zero broken or empty frames", async ({ page }) => {
  const wall = page.getByTestId("identity-wall");
  const marks = wall.locator("svg[data-pattern]");
  await expect(marks).toHaveCount(20);
  for (const pattern of ["beams", "arcs", "crease", "contour"]) {
    expect(
      await wall.locator(`svg[data-pattern="${pattern}"]`).count(),
      `pattern ${pattern} appears on the wall`,
    ).toBeGreaterThan(0);
  }
});

test("identity is deterministic across a full page reload", async ({ page }) => {
  const readWall = () =>
    page
      .getByTestId("identity-wall")
      .locator("svg")
      .evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            `${node.getAttribute("data-pattern") ?? ""}:${node.querySelector("text")?.textContent ?? ""}`,
        ),
      );
  const before = await readWall();
  await page.reload();
  await expect(page.getByTestId("identity-wall")).toBeVisible();
  const after = await readWall();
  expect(after).toEqual(before);
});

test("a broken photo URL recovers to the branded mark — nothing looks unfinished", async ({
  page,
}) => {
  // Photos are lazy: the browser only attempts (and fails) the load once the
  // frame nears the viewport — scroll there like a user would.
  await page.getByText("failure recovery").scrollIntoViewIfNeeded();
  const mark = page.locator("svg[aria-label='Broken Source']");
  await expect(mark).toBeVisible({ timeout: 10_000 });
  await expect(mark.locator("text")).toHaveText("BS");
});

test("photos carry explicit dimensions — zero layout shift by construction", async ({ page }) => {
  const photos = page.locator("[data-testid='player-image'] img");
  const count = await photos.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(photos.nth(i)).toHaveAttribute("width", /\d+/);
    await expect(photos.nth(i)).toHaveAttribute("height", /\d+/);
  }
});

test("marks are named for assistive tech; Devanagari initials render", async ({ page }) => {
  await expect(page.locator("svg[aria-label='रोहित शर्मा'] text").first()).toHaveText("रोश");
  await expect(
    page.locator("svg[aria-label='Yashasvi Bhupendra Kumar Jaiswal'] text").first(),
  ).toHaveText("YJ");
  await expect(page.locator("svg[aria-label='Player']")).toHaveCount(1);
});

test("team color replaces the volt edge when a player belongs to a squad", async ({ page }) => {
  await expect(page.locator("svg rect[fill='#2673D6']")).toHaveCount(1);
  expect(await page.locator("svg rect[fill='#D93843']").count()).toBeGreaterThanOrEqual(1);
});
