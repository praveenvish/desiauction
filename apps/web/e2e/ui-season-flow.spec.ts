import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { competitions, createDb, registrations } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { seedScoringFixture, scoringSession } from "./scoring-fixtures";

const url = process.env["DATABASE_URL"];
if (!url?.includes("127.0.0.1:15437/ls1_c29_clean"))
  throw new Error("Isolated validation database required");

async function capture(page: Page, name: string) {
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
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`${name}-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
}

for (const formation of ["organizer", "team_entry"] as const) {
  test(`${formation} squad assignment keeps factual status and excludes auction-only controls`, async ({
    page,
  }) => {
    const fixture = await seedScoringFixture({ longNames: true });
    const handle = createDb(url, { max: 1 });
    try {
      await handle.db
        .update(competitions)
        .set({ teamFormation: formation })
        .where(eq(competitions.slug, fixture.slug));
      await scoringSession(page.context(), fixture.actorToken);
      await page.goto(`/seasons/${fixture.slug}/readiness`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(
        page.getByRole("heading", { name: "Prepare your teams, then schedule matches" }),
      ).toBeVisible();
      await capture(page, `${formation}-readiness`);
      await page.getByRole("link", { name: "Review teams", exact: true }).click();
      await expect(page.getByTestId("teams-owner-hint")).toHaveCount(0);
      await expect(
        page.getByText("Owner — invited once the auction exists", { exact: true }),
      ).toHaveCount(0);
      await page.goto(`/seasons/${fixture.slug}/registrations?status=approved`);
      await expect(page.getByRole("link", { name: "Set up the auction", exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByTestId("stat-auction-pool")).toContainText(
        "Approved without squad marks",
      );
      await page
        .getByTestId("reg-table")
        .getByTestId(/^open-/)
        .filter({ hasText: "Home player 2" })
        .click();
      await expect(page.getByTestId("player-sheet")).toBeVisible();
      await expect(page.getByTestId("sheet-hand-price")).toHaveCount(0);
      await expect(page.getByTestId("sheet-team").locator('option[value=""]')).toHaveText(
        "No team",
      );
      await page.getByTestId("sheet-team").selectOption("");
      await expect(page.getByTestId("sheet-outcome")).toContainText("not assigned to a team yet");
      await expect(page.getByTestId("squad-status")).toContainText("Choose a team");
      await page.getByTestId("sheet-team").selectOption(fixture.homeId);
      await expect(page.getByTestId("sheet-outcome")).toContainText("assigned to LS1 Strikers");
      await expect(page.getByTestId("player-sheet")).not.toContainText("auction pool");
      await capture(page, `${formation}-squad`);
      await page.getByTestId("sheet-close").click();
      await expect(page).toHaveURL(
        (value) =>
          value.pathname === `/seasons/${fixture.slug}/registrations` &&
          value.searchParams.get("status") === "approved" &&
          !value.searchParams.has("player"),
      );
    } finally {
      await handle.sql.end();
    }
  });
}

test("hand-price transport failure retains the draft, outlives the previous success timer and recovers after acknowledgement", async ({
  page,
}) => {
  const fixture = await seedScoringFixture();
  await scoringSession(page.context(), fixture.actorToken);
  await page.goto(`/seasons/${fixture.slug}/registrations?status=approved`);
  await page
    .getByTestId("reg-table")
    .getByTestId(/^open-/)
    .filter({ hasText: "Home player 2" })
    .click();
  const price = page.getByTestId("sheet-hand-price");
  await price.fill("100");
  await price.press("Tab");
  await expect(price.locator("..").locator("..").getByText("Saved", { exact: true })).toBeVisible();
  await page.route(`**/seasons/${fixture.slug}/registrations**`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"])
      await route.abort("failed");
    else await route.continue();
  });
  await price.fill("200");
  await price.press("Tab");
  await expect(price.locator("..").getByRole("alert")).toContainText("Couldn't confirm the save");
  await expect(price).toHaveValue("200");
  // Cross the prior success timeout: its callback must not erase this failure.
  await page.waitForTimeout(1800);
  await expect(price.locator("..").getByRole("alert")).toContainText("Couldn't confirm the save");
  await expect(page.getByTestId("player-sheet").getByText("Saving…", { exact: true })).toHaveCount(
    0,
  );
  let recoveryPosts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes(`/seasons/${fixture.slug}/registrations`)
    )
      recoveryPosts += 1;
  });
  await page.unroute(`**/seasons/${fixture.slug}/registrations**`);
  await page
    .getByRole("status")
    .filter({ hasText: "Couldn't confirm the current saved record" })
    .getByRole("button", { name: "Reload saved record" })
    .click();
  await expect(price).toHaveValue("100");
  expect(recoveryPosts).toBe(0);
  await price.fill("250");
  await price.press("Tab");
  await expect(price.locator("..").locator("..").getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("sheet-hand-price")).toHaveValue("250");
});

test("organizer assignment can be chosen during real season creation", async ({ page }) => {
  const fixture = await seedScoringFixture();
  await scoringSession(page.context(), fixture.actorToken);
  await page.goto("/seasons");
  await page.getByTestId("new-season").click();
  await page.getByLabel("Season name").filter({ visible: true }).fill(`Assignment ${fixture.slug}`);
  await page.getByLabel("Location").fill("Mumbai");
  await page.getByLabel("Starts on").fill("2026-10-10");
  await page.getByLabel("Ends on").fill("2026-11-30");
  await page.getByLabel("How will teams be formed?").selectOption("organizer");
  await expect(
    page.getByText("You assign registered players to teams before scheduling matches.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page.getByTestId("competition-status")).toHaveText("draft");
  const createdSlug = new URL(page.url()).pathname.split("/")[2];
  const handle = createDb(url, { max: 1 });
  try {
    const [created] = await handle.db
      .select()
      .from(competitions)
      .where(eq(competitions.slug, createdSlug!));
    expect(created?.teamFormation).toBe("organizer");
  } finally {
    await handle.sql.end();
  }
});

for (const formation of ["organizer", "team_entry"] as const) {
  test(`${formation} final squad marks preserve actual assignment and other marks`, async ({
    page,
  }) => {
    const fixture = await seedScoringFixture();
    const handle = createDb(url, { max: 1 });
    try {
      await handle.db
        .update(competitions)
        .set({ teamFormation: formation })
        .where(eq(competitions.slug, fixture.slug));
      await scoringSession(page.context(), fixture.actorToken);
      for (const mark of ["isCaptain", "isIcon", "isRetained"] as const) {
        await handle.db
          .update(registrations)
          .set({ isCaptain: false, isIcon: false, isRetained: false })
          .where(eq(registrations.teamId, fixture.homeId));
        await handle.db
          .update(registrations)
          .set({ [mark]: true })
          .where(eq(registrations.id, fixture.homePlayers[1]!));
        await page.goto(`/seasons/${fixture.slug}/teams?team=${fixture.homeId}`);
        const slot = page.getByTestId(`presign-${mark}`);
        await slot.getByRole("button", { name: /^Remove Home player 2 as/ }).click();
        await expect(slot.getByRole("button", { name: /^Remove Home player 2 as/ })).toHaveCount(0);
        await expect(page.getByTestId("roster-list")).toContainText("Home player 2");
        await expect
          .poll(async () => {
            const [row] = await handle.db
              .select()
              .from(registrations)
              .where(eq(registrations.id, fixture.homePlayers[1]!));
            return { teamId: row?.teamId, mark: row?.[mark] };
          })
          .toEqual({ teamId: fixture.homeId, mark: false });
      }
      await handle.db
        .update(registrations)
        .set({ isIcon: true, isRetained: true })
        .where(eq(registrations.id, fixture.homePlayers[1]!));
      await page.reload();
      await page
        .getByTestId("presign-isIcon")
        .getByRole("button", { name: /^Remove Home player 2 as/ })
        .click();
      await expect
        .poll(async () => {
          const [row] = await handle.db
            .select()
            .from(registrations)
            .where(
              and(
                eq(registrations.id, fixture.homePlayers[1]!),
                eq(registrations.teamId, fixture.homeId),
              ),
            );
          return { icon: row?.isIcon, retained: row?.isRetained };
        })
        .toEqual({ icon: false, retained: true });
    } finally {
      await handle.sql.end();
    }
  });
}

async function openSecondPlayer(page: Page, unit?: "points") {
  const fixture = await seedScoringFixture();
  if (unit) {
    if (!url) throw new Error("Isolated validation database required");
    const handle = createDb(url, { max: 1 });
    try {
      await handle.db
        .update(competitions)
        .set({ auctionUnit: unit })
        .where(eq(competitions.slug, fixture.slug));
    } finally {
      await handle.sql.end();
    }
  }
  await scoringSession(page.context(), fixture.actorToken);
  await page.goto(`/seasons/${fixture.slug}/registrations?status=approved`);
  await page
    .getByTestId("reg-table")
    .getByTestId(/^open-/)
    .filter({ hasText: "Home player 2" })
    .click();
  return fixture;
}

for (const unit of ["inr", "points"] as const) {
  test(`${unit} explicit hand-price refusal retains the draft and unlocks after checking the saved record`, async ({
    page,
  }) => {
    const fixture = await openSecondPlayer(page, unit === "points" ? unit : undefined);
    const maxPrice = unit === "points" ? 100000000 : 1000000000;
    const price = page.getByTestId("sheet-hand-price");
    for (const invalid of ["-1", "1.5", "abc", "9007199254740992", String(maxPrice + 1)]) {
      await price.fill(invalid);
      await price.press("Tab");
      await expect(price.locator("..").getByRole("alert")).toBeVisible();
      await expect(price).toHaveValue(invalid);
      await expect(price).toBeEnabled();
    }
    await expect(page.getByRole("button", { name: "Reload saved record" })).toHaveCount(0);
    const handle = createDb(url, { max: 1 });
    try {
      const [stored] = await handle.db
        .select()
        .from(registrations)
        .where(eq(registrations.id, fixture.homePlayers[1]!));
      expect(stored?.offlinePrice).toBeNull();
    } finally {
      await handle.sql.end();
    }
    let escapePosts = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes(`/seasons/${fixture.slug}/registrations`)
      )
        escapePosts += 1;
    });
    await price.fill("20");
    await price.press("Escape");
    await expect(price).toHaveValue("");
    expect(escapePosts).toBe(0);
    await price.fill(" 100 ");
    await price.press("Tab");
    await expect(price.locator("..").getByText("Saved", { exact: true })).toBeVisible();
    for (const valid of ["0", String(maxPrice), ""]) {
      await price.fill(valid);
      await price.press("Tab");
      await expect(price.locator("..").getByText("Saved", { exact: true })).toBeVisible();
      await expect(price).toBeEnabled();
      const check = createDb(url, { max: 1 });
      try {
        await expect
          .poll(async () => {
            const [stored] = await check.db
              .select()
              .from(registrations)
              .where(eq(registrations.id, fixture.homePlayers[1]!));
            return stored?.offlinePrice;
          })
          .toBe(valid === "" ? null : Number(valid) * 100);
      } finally {
        await check.sql.end();
      }
    }
  });
}

test("an accepted hand-price write with a lost response stays uncertain; keyboard recovery sends no mutation", async ({
  page,
}) => {
  const fixture = await openSecondPlayer(page);
  const price = page.getByTestId("sheet-hand-price");
  let dropped = false;
  await page.route(`**/seasons/${fixture.slug}/registrations**`, async (route) => {
    if (
      !dropped &&
      route.request().method() === "POST" &&
      route.request().headers()["next-action"]
    ) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await price.fill("200");
  await price.press("Tab");
  await expect(price.locator("..").getByRole("alert")).toContainText("Couldn't confirm the save");
  await expect(price).toHaveValue("200");
  await expect(price).toBeDisabled();
  const handle = createDb(url, { max: 1 });
  try {
    const [stored] = await handle.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, fixture.homePlayers[1]!));
    expect(stored?.offlinePrice).toBe(20000);
  } finally {
    await handle.sql.end();
  }
  await expect(price.locator("..").getByText("Saved", { exact: true })).toHaveCount(0);
  await page.unroute(`**/seasons/${fixture.slug}/registrations**`);
  let mutationRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes(`/seasons/${fixture.slug}/registrations`)
    )
      mutationRequests += 1;
  });
  const recovery = page
    .getByRole("status")
    .filter({ hasText: "Couldn't confirm the current saved record" })
    .getByRole("button", { name: "Reload saved record" });
  await recovery.focus();
  await recovery.press("Enter");
  await expect(price).toHaveValue("200");
  await expect(price).toBeEnabled();
  expect(mutationRequests).toBe(0);
});

test("uncertain role selection preserves its choice and does not follow the next player", async ({
  page,
}) => {
  const fixture = await openSecondPlayer(page);
  await page.getByTestId("sheet-tab-details").click();
  const role = page.getByTestId("edit-role");
  const current = await role.inputValue();
  const alternate = await role
    .locator("option")
    .evaluateAll(
      (options, original) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .find((value) => value !== original && value !== ""),
      current,
    );
  expect(alternate).toBeTruthy();
  await page.route(`**/seasons/${fixture.slug}/registrations**`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"])
      await route.abort("failed");
    else await route.continue();
  });
  await role.selectOption(alternate!);
  await expect(role.locator("..").getByRole("alert")).toContainText("Couldn't confirm the save");
  await expect(role).toHaveValue(alternate!);
  await page.unroute(`**/seasons/${fixture.slug}/registrations**`);
  await page.getByTestId("sheet-next").click();
  await expect(page.getByTestId("details-subject")).not.toContainText("Home player 2");
  await page.getByTestId("sheet-tab-details").click();
  await expect(page.getByTestId("edit-role")).toBeEnabled();
  const subject = (await page.getByTestId("details-subject").textContent())?.trim();
  const names = [...fixture.homeNames, ...fixture.awayNames];
  const ids = [...fixture.homePlayers, ...fixture.awayPlayers];
  const nextId = ids[names.indexOf(subject ?? "")];
  if (!nextId) throw new Error("Unknown next player");
  const handle = createDb(url, { max: 1 });
  try {
    const [stored] = await handle.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, nextId));
    await expect(page.getByTestId("edit-role")).toHaveValue(stored?.role ?? "");
  } finally {
    await handle.sql.end();
  }
  await expect(page.getByRole("button", { name: "Reload saved record" })).toHaveCount(0);
});

test("uncertain fee selection preserves its choice until explicit authoritative reload", async ({
  page,
}) => {
  const fixture = await openSecondPlayer(page);
  await page.getByTestId("sheet-tab-fee").click();
  const choices = page.getByTestId("edit-fee-status");
  const before = await choices.getByRole("button", { pressed: true }).textContent();
  await page.route(`**/seasons/${fixture.slug}/registrations**`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"])
      await route.abort("failed");
    else await route.continue();
  });
  await choices.getByRole("button", { name: "Paid", exact: true }).click();
  await expect(choices.getByRole("button", { name: "Paid", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(choices.locator("..").getByRole("alert")).toContainText("Couldn't confirm the save");
  await page.getByTestId("sheet-tab-details").click();
  await page.getByTestId("sheet-tab-fee").click();
  await expect(choices.getByRole("button", { name: "Paid", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.unroute(`**/seasons/${fixture.slug}/registrations**`);
  await page
    .getByRole("status")
    .filter({ hasText: "Couldn't confirm the current saved record" })
    .getByRole("button", { name: "Reload saved record" })
    .click();
  await page.getByTestId("sheet-tab-fee").click();
  await expect(
    page.getByTestId("edit-fee-status").getByRole("button", { pressed: true }),
  ).toHaveText(before!);
});

test("a failed reconciliation read holds recovery after an acknowledged price write", async ({
  page,
}) => {
  const fixture = await openSecondPlayer(page);
  let posts = 0;
  await page.route(`**/seasons/${fixture.slug}/registrations**`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      posts += 1;
      if (posts > 1) {
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  const price = page.getByTestId("sheet-hand-price");
  await price.fill("200");
  await price.press("Tab");
  await expect(price.locator("..").getByRole("alert")).toContainText(
    "Couldn't check the saved record",
  );
  await expect(price).toHaveValue("200");
  await expect(price).toBeDisabled();
  await expect(price.locator("..").getByText("Saved", { exact: true })).toHaveCount(0);
  const handle = createDb(url, { max: 1 });
  try {
    const [stored] = await handle.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, fixture.homePlayers[1]!));
    expect(stored?.offlinePrice).toBe(20000);
  } finally {
    await handle.sql.end();
  }
  await page.unroute(`**/seasons/${fixture.slug}/registrations**`);
  await page
    .getByRole("status")
    .filter({ hasText: "Couldn't confirm the current saved record" })
    .getByRole("button", { name: "Reload saved record" })
    .click();
  await expect(price).toBeEnabled();
  await expect(price).toHaveValue("200");
});

test("duplicate squad activation dispatches once and excludes bulk work until reconciliation", async ({
  page,
}) => {
  const fixture = await seedScoringFixture();
  const handle = createDb(url, { max: 1 });
  try {
    await handle.db
      .update(registrations)
      .set({ isIcon: true })
      .where(eq(registrations.id, fixture.homePlayers[1]!));
    await scoringSession(page.context(), fixture.actorToken);
    await page.goto(`/seasons/${fixture.slug}/teams?team=${fixture.homeId}`);
    let dispatches = 0;
    let resume: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    await page.route(`**/seasons/${fixture.slug}/**`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes('"isIcon":false')
      ) {
        dispatches += 1;
        await held;
      }
      await route.continue();
    });
    try {
      await page
        .getByTestId("presign-isIcon")
        .getByRole("button", { name: /^Remove Home player 2 as/ })
        .evaluate((button) => {
          (button as HTMLButtonElement).click();
          (button as HTMLButtonElement).click();
        });
      await expect.poll(() => dispatches).toBe(1);
      await page
        .getByRole("navigation", { name: "Season sections" })
        .getByRole("link", { name: "Players", exact: true })
        .click();
      await page.getByLabel("Select all on page").check();
      await page.getByTestId("bulk-adult").click();
      await expect(
        page.getByText("Wait for the current change to be checked before starting a bulk action.", {
          exact: true,
        }),
      ).toBeVisible();
      const unchanged = await handle.db
        .select()
        .from(registrations)
        .where(eq(registrations.id, fixture.homePlayers[1]!));
      expect(unchanged[0]?.adultConfirmedAt).toBeNull();
      expect(dispatches).toBe(1);
    } finally {
      resume?.();
    }
    await expect
      .poll(async () => {
        const [stored] = await handle.db
          .select()
          .from(registrations)
          .where(eq(registrations.id, fixture.homePlayers[1]!));
        return stored?.isIcon;
      })
      .toBe(false);
  } finally {
    await handle.sql.end();
  }
});

test("bulk writes exclude sheet edits through the authoritative batch read", async ({ page }) => {
  const fixture = await seedScoringFixture();
  await scoringSession(page.context(), fixture.actorToken);
  await page.goto(`/seasons/${fixture.slug}/registrations?status=approved`);
  await page.getByLabel("Select all on page").check();
  await page
    .getByTestId("reg-table")
    .getByTestId(/^open-/)
    .filter({ hasText: "Home player 2" })
    .click();
  let first = true;
  let firstAction = "";
  let writerDispatches = 0;
  let resume: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route(`**/seasons/${fixture.slug}/registrations**`, async (route) => {
    const action = route.request().headers()["next-action"];
    if (route.request().method() === "POST" && action) {
      if (first) {
        first = false;
        firstAction = action;
        writerDispatches += 1;
        await held;
      } else if (action === firstAction) writerDispatches += 1;
    }
    await route.continue();
  });
  try {
    await page.getByTestId("bulk-adult").click();
    await expect.poll(() => writerDispatches).toBe(1);
    await expect(page.getByTestId("sheet-team")).toBeDisabled();
    await page
      .getByTestId(/^captain-toggle-/)
      .evaluate((button) => (button as HTMLButtonElement).click());
    expect(writerDispatches).toBe(1);
    await expect(page.getByTestId("sheet-close")).toBeEnabled();
    await expect(page.getByTestId("sheet-tab-details")).toBeEnabled();
  } finally {
    resume?.();
  }
  await expect(page.getByTestId("sheet-team")).toBeEnabled();
  const handle = createDb(url, { max: 1 });
  try {
    const [stored] = await handle.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, fixture.homePlayers[1]!));
    expect(stored?.adultConfirmedAt).not.toBeNull();
    expect(stored?.isCaptain).toBe(false);
  } finally {
    await handle.sql.end();
  }
  expect(writerDispatches).toBe(1);
});

test("off-page non-approved captain is reconciled and the squad reader refuses a scorer-only actor", async ({
  page,
  browser,
}) => {
  const fixture = await seedScoringFixture();
  const handle = createDb(url, { max: 1 });
  const viewer = await browser.newContext({ baseURL: "http://localhost:3050" });
  try {
    await handle.db
      .update(registrations)
      .set({ status: "waitlisted" })
      .where(eq(registrations.id, fixture.homePlayers[0]!));
    await scoringSession(page.context(), fixture.actorToken);
    await page.goto(`/seasons/${fixture.slug}/registrations?status=approved`);
    await page
      .getByTestId("reg-table")
      .getByTestId(/^open-/)
      .filter({ hasText: "Home player 2" })
      .click();
    let readRequest: { action: string; contentType: string; body: string } | undefined;
    page.on("request", (request) => {
      if (
        !readRequest &&
        request.method() === "POST" &&
        request.postData()?.includes(fixture.homePlayers[1]!)
      ) {
        readRequest = {
          action: request.headers()["next-action"] ?? "",
          contentType: request.headers()["content-type"] ?? "text/plain",
          body: request.postData() ?? "",
        };
      }
    });
    await page.getByTestId(/^captain-toggle-/).click();
    await expect(page.getByTestId(/^captain-toggle-/)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(/^captain-toggle-/)).toBeEnabled();
    const prior = await handle.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, fixture.homePlayers[0]!));
    const current = await handle.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, fixture.homePlayers[1]!));
    expect(prior[0]).toMatchObject({ status: "waitlisted", isCaptain: false });
    expect(current[0]).toMatchObject({ isCaptain: true, teamId: fixture.homeId });
    if (!readRequest?.action) throw new Error("Missing actual squad-read request");
    await scoringSession(viewer, fixture.nextActorToken);
    const refused = await viewer.request.post(
      `/seasons/${fixture.slug}/registrations?status=approved`,
      {
        headers: {
          "next-action": readRequest.action,
          "content-type": readRequest.contentType,
          origin: "http://localhost:3050",
        },
        data: readRequest.body,
      },
    );
    const payload = await refused.text();
    expect(payload).toContain("Saved squad state is not available.");
    expect(payload).not.toContain('"isCaptain":');
    expect(payload).not.toContain('"phone":');
    expect(payload).not.toContain('"feeAmountPaise":');
  } finally {
    await viewer.close();
    await handle.sql.end();
  }
});

test("legacy lineup and match-day links retain the selected match and date", async ({ page }) => {
  const fixture = await seedScoringFixture();
  await scoringSession(page.context(), fixture.actorToken);
  await page.goto(`/seasons/${fixture.slug}/lineups?fixture=${fixture.fixtureId}`);
  await expect(page).toHaveURL(
    (value) =>
      value.pathname === `/seasons/${fixture.slug}/fixtures` &&
      value.searchParams.get("match") === fixture.fixtureId,
  );
  await expect(page.getByTestId("match-panel")).toBeVisible();
  await page.getByTestId("match-panel-close").click();
  await expect(page).toHaveURL(
    (value) =>
      value.pathname === `/seasons/${fixture.slug}/fixtures` && !value.searchParams.has("match"),
  );
  await page.goto(`/seasons/${fixture.slug}/fixtures/match-day?date=2026-10-10`);
  await expect(page).toHaveURL(
    (value) =>
      value.pathname === `/seasons/${fixture.slug}/fixtures` &&
      value.searchParams.get("date") === "2026-10-10",
  );
  await page.goto(`/seasons/${fixture.slug}/lineups?fixture=invalid`);
  await expect(page).toHaveURL(
    (value) =>
      value.pathname === `/seasons/${fixture.slug}/fixtures` && !value.searchParams.has("match"),
  );
});
