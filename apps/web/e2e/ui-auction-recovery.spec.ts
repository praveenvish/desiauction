import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_AUCTION_CONFIG, PRACTICE_BASE_POINTS } from "@desiauction/core";
import { auctions, bids, competitions, createDb, newId } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { seedScoringFixture, scoringSession } from "./scoring-fixtures";

import { auctionValidationEnv } from "./env";
const databaseUrl = auctionValidationEnv.databaseUrl;
async function fixture() {
  const scoring = await seedScoringFixture();
  const handle = createDb(databaseUrl, { max: 1 });
  try {
    const [season] = await handle.db
      .select()
      .from(competitions)
      .where(eq(competitions.slug, scoring.slug));
    if (!season) throw new Error("Missing season");
    const realId = newId();
    await handle.db.insert(auctions).values({
      id: realId,
      orgId: season.orgId,
      competitionId: season.id,
      createdBy: scoring.actorId,
      name: "Recovery rehearsal",
      config: DEFAULT_AUCTION_CONFIG,
    });
    return { ...scoring, realId, seasonId: season.id };
  } finally {
    await handle.sql.end();
  }
}
async function practices(seasonId: string) {
  const handle = createDb(databaseUrl, { max: 1 });
  try {
    return await handle.db
      .select()
      .from(auctions)
      .where(and(eq(auctions.competitionId, seasonId), eq(auctions.kind, "practice")));
  } finally {
    await handle.sql.end();
  }
}
async function openCard(page: Page, slug: string) {
  await page.goto(`/seasons/${slug}/auction`);
  await expect(page.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByTestId("practice-card")).toBeVisible();
}
async function start(page: Page) {
  const button = page.getByTestId("practice-start");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByTestId("practice-running")).toBeVisible();
}
async function markers(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Array<{ commandId: string; state: string; context: Record<string, unknown> }>>(
        (resolve, reject) => {
          const request = indexedDB.open("keyval-store");
          request.onerror = () => {
            reject(request.error ?? new Error("Recovery database could not open"));
          };
          request.onsuccess = () => {
            const db = request.result;
            const store = db.transaction("keyval", "readonly").objectStore("keyval");
            const cursor = store.openCursor();
            const result: Array<{
              commandId: string;
              state: string;
              context: Record<string, unknown>;
            }> = [];
            cursor.onerror = () => {
              db.close();
              reject(cursor.error ?? new Error("Recovery cursor failed"));
            };
            cursor.onsuccess = () => {
              const value = cursor.result;
              if (!value) {
                db.close();
                resolve(result);
                return;
              }
              if (
                typeof value.key === "string" &&
                value.key.startsWith("ls1:auction-recovery:v1:")
              ) {
                const stored: unknown = value.value;
                if (!Array.isArray(stored)) {
                  db.close();
                  reject(new Error("Malformed recovery records"));
                  return;
                }
                for (const item of stored as unknown[]) {
                  if (typeof item !== "object" || item === null) {
                    db.close();
                    reject(new Error("Malformed recovery marker"));
                    return;
                  }
                  const marker = item as Record<string, unknown>;
                  if (
                    typeof marker.commandId !== "string" ||
                    typeof marker.state !== "string" ||
                    typeof marker.context !== "object" ||
                    marker.context === null ||
                    Array.isArray(marker.context)
                  ) {
                    db.close();
                    reject(new Error("Malformed recovery identity"));
                    return;
                  }
                  result.push({
                    commandId: marker.commandId,
                    state: marker.state,
                    context: marker.context as Record<string, unknown>,
                  });
                }
              }
              value.continue();
            };
          };
        },
      ),
  );
}

test("lost created-practice answer survives reload without replay or another creation", async ({
  page,
}) => {
  const data = await fixture();
  await scoringSession(page.context(), data.actorToken);
  await openCard(page, data.slug);
  let posts = 0;
  await page.route(`**/seasons/${data.slug}/auction`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      posts++;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await startUnknown(page);
  await expect.poll(async () => (await practices(data.seasonId)).length).toBe(1);
  const initial = await markers(page);
  expect(initial).toHaveLength(1);
  expect(initial[0]?.context).toMatchObject({ realAuctionId: data.realId, perTeam: 2 });
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(page.getByTestId("practice-recovery")).toBeVisible();
  expect((await markers(page))[0]?.commandId).toBe(initial[0]?.commandId);
  await expect(page.getByTestId("practice-end")).toBeDisabled();
  expect(posts).toBe(1);
  expect(await practices(data.seasonId)).toHaveLength(1);
  await page.getByRole("button", { name: "Check current practice", exact: true }).click();
  await expect(page.getByText(/Current practice: Another practice/)).toBeVisible();
  await page
    .getByRole("button", { name: "Reviewed current practice · allow a new action" })
    .click();
  await expect(page.getByTestId("practice-recovery")).toHaveCount(0);
  expect((await markers(page))[0]?.state).toBe("reviewed");
  expect(await practices(data.seasonId)).toHaveLength(1);
});
async function startUnknown(page: Page) {
  await expect(page.getByTestId("practice-start")).toBeEnabled();
  await page.getByTestId("practice-start").click();
  await expect(page.getByTestId("practice-recovery")).toContainText("Practice action unconfirmed");
}

test("a stale open End dialog keeps its old identity and cannot end a replacement", async ({
  browser,
}) => {
  const data = await fixture();
  const context = await browser.newContext();
  try {
    await scoringSession(context, data.actorToken);
    const oldPage = await context.newPage();
    const currentPage = await context.newPage();
    await openCard(oldPage, data.slug);
    await start(oldPage);
    const oldRows = await practices(data.seasonId);
    const old = oldRows[0];
    if (!old) throw new Error("Missing first practice");
    await oldPage.getByTestId("practice-end").click();
    await expect(oldPage.getByTestId("confirm-practice-end")).toBeVisible();
    await openCard(currentPage, data.slug);
    await currentPage.getByTestId("practice-end").click();
    await currentPage.getByTestId("confirm-practice-end").click();
    await expect(currentPage.getByTestId("practice-start")).toBeVisible();
    await start(currentPage);
    const before = await practices(data.seasonId);
    expect(before).toHaveLength(2);
    await oldPage.getByTestId("confirm-practice-end").click();
    await expect(
      oldPage.getByText("The practice changed. This action has not been sent."),
    ).toBeVisible();
    const after = await practices(data.seasonId);
    expect(after.map(({ id, status }) => ({ id, status }))).toEqual(
      before.map(({ id, status }) => ({ id, status })),
    );
    await expect(oldPage.getByTestId("confirm-practice-end")).toBeVisible();
    expect(await markers(oldPage)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("held Run again excludes a second card and lost composition retains dialog and old identity", async ({
  browser,
}) => {
  const data = await fixture();
  const context = await browser.newContext();
  try {
    await scoringSession(context, data.actorToken);
    const first = await context.newPage();
    const second = await context.newPage();
    await openCard(first, data.slug);
    await start(first);
    await openCard(second, data.slug);
    const original = (await practices(data.seasonId))[0];
    if (!original) throw new Error("Missing selected practice");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    await first.route(`**/seasons/${data.slug}/auction`, async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
        posts++;
        await held;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await first.getByTestId("practice-again").click();
    await first.getByTestId("confirm-practice-again").click();
    await expect.poll(() => posts).toBe(1);
    await first.getByTestId("confirm-practice-again").evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await expect(second.getByTestId("practice-end")).toBeDisabled();
    await second.getByTestId("practice-end").evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await expect(second.getByTestId("practice-recovery")).toBeVisible();
    expect(await practices(data.seasonId)).toHaveLength(1);
    release();
    await expect(first.getByTestId("practice-recovery")).toContainText(
      "Practice action unconfirmed",
    );
    await expect(first.getByTestId("confirm-practice-again")).toBeVisible();
    await expect.poll(async () => (await practices(data.seasonId)).length).toBe(2);
    expect(posts).toBe(1);
    expect((await markers(first))[0]?.context["practiceId"]).toBe(original.id);
    await first.unrouteAll({ behavior: "wait" });
    await first.reload();
    await expect(first.getByTestId("practice-recovery")).toBeVisible();
    await expect(first.getByTestId("practice-again")).toBeDisabled();
    const rows = await practices(data.seasonId);
    expect(rows.filter((row) => row.status !== "abandoned")).toHaveLength(1);
    expect(rows.find((row) => row.id === original.id)?.status).toBe("abandoned");
  } finally {
    await context.close();
  }
});

test("unavailable actual browser storage prevents practice dispatch", async ({ browser }) => {
  const data = await fixture();
  const context = await browser.newContext();
  try {
    await scoringSession(context, data.actorToken);
    await context.addInitScript(() => {
      indexedDB.open = () => {
        throw new DOMException("Unavailable", "SecurityError");
      };
    });
    const page = await context.newPage();
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) writes++;
    });
    await openCard(page, data.slug);
    await expect(page.getByTestId("practice-recovery")).toContainText(
      "Recovery storage could not be opened",
    );
    await expect(page.getByTestId("practice-start")).toBeDisabled();
    expect(await practices(data.seasonId)).toHaveLength(0);
    expect(writes).toBe(0);
  } finally {
    await context.close();
  }
});

test("damaged persisted recovery is surfaced and never treated as an empty list", async ({
  browser,
}) => {
  const data = await fixture();
  const context = await browser.newContext();
  try {
    await scoringSession(context, data.actorToken);
    const page = await context.newPage();
    await openCard(page, data.slug);
    await expect(page.getByTestId("practice-start")).toBeEnabled();
    await page.evaluate(
      ({ actor, boundary }) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("keyval-store");
          request.onerror = () => {
            reject(request.error ?? new Error("Recovery database could not open"));
          };
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction("keyval", "readwrite");
            transaction
              .objectStore("keyval")
              .put({ damaged: true }, `ls1:auction-recovery:v1:${actor}:${boundary}`);
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onabort = () => {
              db.close();
              reject(transaction.error ?? new Error("Recovery transaction aborted"));
            };
          };
        }),
      { actor: data.actorId, boundary: data.realId },
    );
    await page.reload();
    await expect(page.getByTestId("practice-recovery")).toContainText(
      "Auction recovery records could not be read.",
    );
    await expect(page.getByTestId("practice-start")).toBeDisabled();
    await page.getByRole("button", { name: "Check recovery storage" }).click();
    await expect(page.getByTestId("practice-recovery")).toContainText(
      "Auction recovery records could not be read.",
    );
    expect(await practices(data.seasonId)).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("another authenticated actor purges a held intent and its late answer cannot revive it", async ({
  browser,
}) => {
  const first = await fixture();
  const second = await fixture();
  const context = await browser.newContext();
  try {
    await scoringSession(context, first.actorToken);
    const old = await context.newPage();
    await openCard(old, first.slug);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted = false;
    let posts = 0;
    await old.route(`**/seasons/${first.slug}/auction`, async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
        posts++;
        const response = await route.fetch();
        accepted = true;
        await hold;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await expect(old.getByTestId("practice-start")).toBeEnabled();
    await old.getByTestId("practice-start").click();
    await expect.poll(() => accepted).toBe(true);
    expect(await markers(old)).toHaveLength(1);
    await scoringSession(context, second.actorToken);
    const current = await context.newPage();
    await openCard(current, second.slug);
    await expect(current.getByTestId("practice-start")).toBeEnabled();
    await expect.poll(async () => (await markers(old)).length).toBe(0);
    release();
    await old.unrouteAll({ behavior: "wait" });
    await expect.poll(async () => (await markers(current)).length).toBe(0);
    expect(posts).toBe(1);
    expect(await practices(first.seasonId)).toHaveLength(1);
    expect(await practices(second.seasonId)).toHaveLength(0);
    await start(current);
    await context.addInitScript(() => {
      const observed = window as unknown as { actorWrites: number };
      observed.actorWrites = 0;
      const original = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, "put")?.value as
        typeof IDBObjectStore.prototype.put | undefined;
      if (!original) throw new Error("Missing native IndexedDB writer");
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        if (key === "ls1:actor") observed.actorWrites++;
        return original.call(this, value, key);
      };
    });
    await current.goto(`/seasons/${second.slug}/auction/cockpit`);
    await expect(current.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true");
    await expect(current.getByTestId("cockpit-open-auction")).toBeEnabled();
    await current.getByTestId("cockpit-more").click();
    await expect(current.getByTestId("cockpit-complete")).toBeEnabled();
    expect(
      await current.evaluate(() => (window as unknown as { actorWrites: number }).actorWrites),
    ).toBe(1);
  } finally {
    await context.close();
  }
});

test("sign out purges a pending practice marker and a late accepted response cannot recreate it", async ({
  browser,
}) => {
  const data = await fixture();
  const context = await browser.newContext();
  try {
    await scoringSession(context, data.actorToken);
    const pending = await context.newPage();
    const account = await context.newPage();
    await openCard(pending, data.slug);
    await account.goto("/account");
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted = false;
    await pending.route(`**/seasons/${data.slug}/auction`, async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
        const response = await route.fetch();
        accepted = true;
        await hold;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await expect(pending.getByTestId("practice-start")).toBeEnabled();
    await pending.getByTestId("practice-start").click();
    await expect.poll(() => accepted).toBe(true);
    expect(await markers(pending)).toHaveLength(1);
    await account.getByRole("button", { name: "Sign out", exact: true }).click();
    await account.getByTestId("sign-out-confirm").click();
    await expect(account).toHaveURL(/\/login/);
    await expect.poll(async () => (await markers(pending)).length).toBe(0);
    release();
    await pending.unrouteAll({ behavior: "wait" });
    await expect.poll(async () => (await markers(pending)).length).toBe(0);
    expect(await practices(data.seasonId)).toHaveLength(1);
  } finally {
    await context.close();
  }
});

async function openLivePractice(page: Page, slug: string) {
  await openCard(page, slug);
  await start(page);
  await page.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(page.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByTestId("cockpit-open-auction")).toBeEnabled();
  await page.getByTestId("cockpit-open-auction").click();
  await expect(page.getByTestId("cockpit-open-auction")).toHaveCount(0);
  await expect
    .poll(async () => (await markers(page)).filter((item) => item.state !== "reviewed").length)
    .toBe(0);
  await page.goto(`/seasons/${slug}/auction/live`);
  await expect(page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  await expect(page.getByTestId("conduct-open-lot")).toBeEnabled();
  await page.getByTestId("conduct-open-lot").click();
  await expect(page.getByTestId("bid-next")).toBeEnabled();
}
async function recordedBids(auctionId: string) {
  const handle = createDb(databaseUrl, { max: 1 });
  try {
    return await handle.db.select().from(bids).where(eq(bids.auctionId, auctionId));
  } finally {
    await handle.sql.end();
  }
}

test("held and lost actual bid excludes practice termination across tabs and submits once", async ({
  browser,
}) => {
  const data = await fixture();
  const context = await browser.newContext();
  try {
    await scoringSession(context, data.actorToken);
    const bidder = await context.newPage();
    const card = await context.newPage();
    await openLivePractice(bidder, data.slug);
    const old = (await practices(data.seasonId))[0];
    if (!old) throw new Error("Missing practice");
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let bidPosts = 0;
    await bidder.route(`**/seasons/${data.slug}/auction/live`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes('"PlaceBid"')
      ) {
        bidPosts++;
        await route.fetch();
        await hold;
        await route.abort("failed");
      } else await route.continue();
    });
    await bidder.getByTestId("bid-next").evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => bidPosts).toBe(1);
    await expect.poll(async () => (await recordedBids(old.id)).length).toBe(1);
    expect((await recordedBids(old.id))[0]?.amount).toBe(PRACTICE_BASE_POINTS * 100);
    await openCard(card, data.slug);
    await expect(card.getByTestId("practice-end")).toBeDisabled();
    await expect(card.getByTestId("practice-again")).toBeDisabled();
    await expect(card.getByText(/A practice bid or correction needs review/)).toBeVisible();
    const before = (await markers(bidder)).find((item) => item.context["amountRaw"] !== undefined);
    if (!before) throw new Error("Missing bid recovery identity");
    release();
    await expect(bidder.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    await bidder.unrouteAll({ behavior: "wait" });
    await bidder.reload();
    await expect(bidder.getByTestId("auction-command-recovery")).toContainText(
      "Command outcome unknown",
    );
    expect((await markers(bidder)).find((item) => item.commandId === before.commandId)?.state).toBe(
      "unknown",
    );
    expect(bidPosts).toBe(1);
    expect(await recordedBids(old.id)).toHaveLength(1);
    await bidder
      .getByRole("button", { name: "Reviewed current room · allow a new action" })
      .click();
    await expect(bidder.getByTestId("auction-command-recovery")).toHaveCount(0);
    await expect(card.getByTestId("practice-end")).toBeEnabled();
    expect(await recordedBids(old.id)).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test("held practice End excludes bidding in the reverse order while pause stays available", async ({
  browser,
}) => {
  const data = await fixture();
  const context = await browser.newContext();
  try {
    await scoringSession(context, data.actorToken);
    const bidder = await context.newPage();
    const card = await context.newPage();
    await openLivePractice(bidder, data.slug);
    await openCard(card, data.slug);
    const old = (await practices(data.seasonId))[0];
    if (!old) throw new Error("Missing practice");
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ends = 0;
    await card.route(`**/seasons/${data.slug}/auction`, async (route) => {
      if (route.request().method() === "POST" && route.request().postData()?.includes(old.id)) {
        ends++;
        await hold;
        await route.abort("failed");
      } else await route.continue();
    });
    await card.getByTestId("practice-end").click();
    await card.getByTestId("confirm-practice-end").click();
    await expect.poll(() => ends).toBe(1);
    await expect(bidder.getByTestId("bid-next")).toBeDisabled();
    await expect(bidder.getByTestId("conduct-pause")).toBeEnabled();
    expect(await recordedBids(old.id)).toHaveLength(0);
    release();
    await expect(card.getByTestId("practice-recovery")).toContainText(
      "Practice action unconfirmed",
    );
    await expect(bidder.getByTestId("bid-next")).toBeDisabled();
    expect((await practices(data.seasonId)).find((row) => row.id === old.id)?.status).toBe("live");
  } finally {
    await context.close();
  }
});

test("a late accepted cockpit End cannot take over a client navigation and remains recoverable", async ({
  browser,
}) => {
  const data = await fixture();
  const context = await browser.newContext();
  try {
    await scoringSession(context, data.actorToken);
    const page = await context.newPage();
    await openCard(page, data.slug);
    await start(page);
    const old = (await practices(data.seasonId))[0];
    if (!old) throw new Error("Missing practice");
    await page.goto(`/seasons/${data.slug}/auction/cockpit`);
    await expect(page.getByTestId("cockpit-panel")).toHaveAttribute("data-hydrated", "true");
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted = false;
    let endPosts = 0;
    await page.route(`**/seasons/${data.slug}/auction/cockpit`, async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postData()?.includes(old.id) &&
        route.request().postData()?.includes(data.realId)
      ) {
        endPosts++;
        const response = await route.fetch();
        accepted = true;
        await hold;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await page.getByTestId("cockpit-more").click();
    await page.getByTestId("cockpit-complete").click();
    await expect.poll(() => accepted).toBe(true);
    const pending = (await markers(page)).find((item) => item.context["practiceId"] === old.id);
    if (!pending) throw new Error("Missing original End identity");
    // Next serializes Server Actions and refreshes. The existing client link
    // can leave the keyed cockpit without waiting for its held action answer.
    await page.getByRole("link", { name: "Practice settings", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/seasons/${data.slug}/auction$`));
    await expect(page.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true");
    release();
    await page.unrouteAll({ behavior: "wait" });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          }),
        ),
    );
    await expect(page).toHaveURL(new RegExp(`/seasons/${data.slug}/auction$`));
    await expect(page.getByText("The selected practice is ended.", { exact: true })).toHaveCount(0);
    expect(
      (await markers(page)).find((item) => item.commandId === pending.commandId)?.context[
        "practiceId"
      ],
    ).toBe(old.id);
    await expect(page.getByTestId("practice-recovery")).toContainText(
      "Practice action unconfirmed",
    );
    await page.reload();
    await expect(page.getByTestId("practice-recovery")).toContainText(
      "Practice action unconfirmed",
    );
    expect(endPosts).toBe(1);
    expect(await practices(data.seasonId)).toHaveLength(1);
    expect((await practices(data.seasonId)).find((row) => row.id === old.id)?.status).toBe(
      "abandoned",
    );
  } finally {
    await context.close();
  }
});
