import { createHash, randomBytes } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  createDb,
  newId,
  people,
  organizations,
  orgMembers,
  competitions,
  teams,
  registrations,
  fixtures,
  fixtureLineups,
  fixtureParticipants,
  grants,
  sessions,
  matches,
  matchEvents,
  matchAwards,
  fixtureResults,
  matchLiveState,
  teamManagers,
  auditLog,
} from "@desiauction/db";
import type { PublicScoringState as PublicLiveState } from "@desiauction/core/scoring";

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
export interface ScoringFixture {
  fixtureId: string;
  slug: string;
  homeId: string;
  awayId: string;
  homePlayers: string[];
  awayPlayers: string[];
  homeNames: string[];
  awayNames: string[];
  actorId: string;
  actorToken: string;
  nextActorId: string;
  nextActorToken: string;
}
/** Unique synthetic rows, per-call owner connection, following player-fixtures.ts. */
export async function seedScoringFixture(
  options: {
    sport?:
      | "cricket"
      | "badminton"
      | "table_tennis"
      | "volleyball"
      | "pickleball"
      | "kabaddi"
      | "football"
      | "hockey"
      | "basketball"
      | "battle_royale";
    formatKey?: string;
    publicDelaySeconds?: number;
    kickoffTime?: string;
    teamManaged?: boolean;
    minorPlayer?: boolean;
    language?: "en" | "hi";
    longNames?: boolean;
  } = {},
): Promise<ScoringFixture> {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const { db } = handle;
    const orgId = newId(),
      competitionId = newId(),
      fixtureId = newId();
    const homeId = newId(),
      awayId = newId(),
      actorId = newId(),
      nextActorId = newId();
    const slug = `ls1-t10-${competitionId.toLowerCase()}`;
    const actorToken = randomBytes(32).toString("base64url");
    const nextActorToken = randomBytes(32).toString("base64url");
    await db.insert(people).values([
      {
        id: actorId,
        name: "LS1 scorer",
        email: `${actorId}@example.test`,
        language: options.language,
      },
      { id: nextActorId, name: "LS1 next scorer", email: `${nextActorId}@example.test` },
    ]);
    await db.insert(organizations).values({
      id: orgId,
      name: `LS1 ${orgId}`,
      slug: `ls1-${orgId.toLowerCase()}`,
      createdBy: actorId,
    });
    await db.insert(orgMembers).values({ orgId, personId: actorId });
    await db.insert(competitions).values({
      id: competitionId,
      orgId,
      name: `LS1 ${competitionId}`,
      slug,
      sport: options.sport ?? "cricket",
      status: "registration_closed",
      visibility: "public",
      scoringRules: {
        ...(options.publicDelaySeconds === undefined
          ? {}
          : { publicDelaySeconds: options.publicDelaySeconds }),
        formatKey: options.formatKey ?? "t10",
        shotMap: "boundaries",
        ball: { type: "leather", colour: "white" },
      },
      createdBy: actorId,
    });
    await db.insert(teams).values(
      [
        { id: homeId, name: "LS1 Strikers" },
        { id: awayId, name: "LS1 Royals" },
      ].map((team) => ({ ...team, orgId, competitionId, createdBy: actorId })),
    );
    const homePlayers: string[] = [],
      awayPlayers: string[] = [];
    const homeNames: string[] = [],
      awayNames: string[] = [];
    for (const [teamId, ids, names, prefix] of [
      [homeId, homePlayers, homeNames, "Home"],
      [awayId, awayPlayers, awayNames, "Away"],
    ] as const) {
      for (let index = 0; index < 11; index++) {
        const personId = newId(),
          id = newId(),
          name = options.longNames
            ? `${prefix} player ${String(index + 1)} · लंबा खिलाड़ी नाम for layout validation`
            : `${prefix} player ${String(index + 1)}`;
        ids.push(id);
        names.push(name);
        await db.insert(people).values({ id: personId, name, clubOrgId: orgId });
        await db.insert(registrations).values({
          id,
          personId,
          orgId,
          competitionId,
          teamId,
          status: "approved",
          registrationNumber: `LS1-${prefix}-${String(index + 1)}`,
          isCaptain: index === 0,
          ...(options.minorPlayer && teamId === awayId && index === 10
            ? { dateOfBirth: "2012-01-01" }
            : {}),
          role: ["football", "hockey"].includes(options.sport ?? "")
            ? index === 0
              ? "goalkeeper"
              : "defender"
            : options.sport === "basketball"
              ? "point_guard"
              : options.sport === "volleyball"
                ? "attacker"
                : options.sport === "pickleball"
                  ? "all_court"
                  : index === 1
                    ? "wicket_keeper"
                    : "batter",
          battingStyle: "right_hand",
          bowlingStyle: "right_arm_medium",
        });
      }
    }
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    await db.insert(fixtures).values({
      id: fixtureId,
      orgId,
      competitionId,
      homeTeamId: options.sport === "battle_royale" ? null : homeId,
      awayTeamId: options.sport === "battle_royale" ? null : awayId,
      fixtureNumber: "Match 1",
      seq: 1,
      kickoffAt: `${day}T${options.kickoffTime ?? "19:00"}`,
      status: "published",
      publishedAt: new Date(),
      createdBy: actorId,
    });
    if (options.sport === "battle_royale")
      await db
        .insert(fixtureParticipants)
        .values([homeId, awayId].map((teamId) => ({ fixtureId, teamId, orgId, competitionId })));
    await db.insert(fixtureLineups).values(
      [...homePlayers, ...awayPlayers].map((registrationId, index) => ({
        fixtureId,
        registrationId,
        teamId: index < 11 ? homeId : awayId,
        orgId,
        competitionId,
        recordedBy: actorId,
        createdAt: new Date(Date.now() + index),
      })),
    );
    if (options.teamManaged) {
      await db.insert(teamManagers).values([
        {
          id: newId(),
          teamId: homeId,
          personId: actorId,
          orgId,
          competitionId,
          role: "captain",
          source: "organizer",
          createdBy: actorId,
        },
        {
          id: newId(),
          teamId: awayId,
          personId: nextActorId,
          orgId,
          competitionId,
          role: "captain",
          source: "organizer",
          createdBy: actorId,
        },
      ]);
    } else
      await db.insert(grants).values([
        {
          id: newId(),
          personId: actorId,
          scopeType: "org" as const,
          scopeId: orgId,
          capabilitySet: "org:owner",
          grantedBy: actorId,
        },
        ...[actorId, nextActorId].map((personId) => ({
          id: newId(),
          personId,
          scopeType: "tournament" as const,
          scopeId: competitionId,
          capabilitySet: "fixture:scorer",
          grantedBy: actorId,
        })),
      ]);
    await db.insert(sessions).values(
      [
        [actorId, actorToken],
        [nextActorId, nextActorToken],
      ].map(([personId, token]) => ({
        id: newId(),
        personId: personId!,
        tokenHash: createHash("sha256").update(token!).digest("hex"),
        expiresAt: new Date(Date.now() + 3 * 3600000),
      })),
    );
    return {
      fixtureId,
      slug,
      homeId,
      awayId,
      homePlayers,
      awayPlayers,
      homeNames,
      awayNames,
      actorId,
      actorToken,
      nextActorId,
      nextActorToken,
    };
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}
export async function scoringSession(context: BrowserContext, token: string) {
  await context.addCookies([
    {
      name: "da_session",
      value: token,
      url: "http://localhost:3050",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
export async function confirmationNoticeFor(fixtureId: string, personId: string) {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const rows = await handle.db.select().from(auditLog).where(eq(auditLog.scopeId, personId));
    return (
      rows.find(
        (row) =>
          row.action === "match.confirm_requested" &&
          row.meta !== null &&
          typeof row.meta === "object" &&
          "fixtureId" in row.meta &&
          row.meta.fixtureId === fixtureId,
      )?.id ?? null
    );
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}
export async function startScoring(page: Page, fixture: ScoringFixture) {
  page.setDefaultTimeout(15000);
  await scoringSession(page.context(), fixture.actorToken);
  await page.goto(`/score/${fixture.fixtureId}/setup`);
  await page.getByRole("button", { name: "Looks right Confirm conditions", exact: true }).click();
  await page.getByRole("button", { name: "Both XIs ready Next: toss", exact: true }).click();
  await page.getByTestId("setup-start").click();
  await page.waitForURL(`**/score/${fixture.fixtureId}`);
  await expect(page.getByTestId("pad-run-0")).toBeEnabled();
}
export async function readScoringFixture(fixtureId: string) {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const [match] = await handle.db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
    const events = await handle.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, fixtureId));
    const [result] = await handle.db
      .select()
      .from(fixtureResults)
      .where(eq(fixtureResults.fixtureId, fixtureId));
    const [projection] = await handle.db
      .select()
      .from(matchLiveState)
      .where(eq(matchLiveState.fixtureId, fixtureId));
    return {
      match,
      events: events.sort((a, b) => a.seq - b.seq),
      result,
      projection: projection
        ? { ...projection, state: projection.state as PublicLiveState }
        : undefined,
    };
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}
export async function sent(page: Page) {
  await expect(page.getByTestId("pad-sync")).toHaveAttribute("data-pending", "0", {
    timeout: 30000,
  });
}
/** Read committed storage only; never flush or mutate the application queue. */
export async function persistedQueue(page: Page, fixtureId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ event: { eventId: string; type: string } }[]>(
        (resolve, reject) => {
          const transaction = database.transaction("keyval", "readonly");
          const request = transaction.objectStore("keyval").get(`ls1:queue:${id}`);
          transaction.oncomplete = () => resolve(request.result ?? []);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        },
      );
    } finally {
      database.close();
    }
  }, fixtureId);
}
export async function committedQueue(page: Page, fixtureId: string, types: string[]) {
  await expect
    .poll(async () => (await persistedQueue(page, fixtureId)).map((item) => item.event.type), {
      timeout: 15000,
    })
    .toEqual(types);
  const ids = (await persistedQueue(page, fixtureId)).map((item) => item.event.eventId);
  expect(ids).toHaveLength(types.length);
  expect(new Set(ids).size).toBe(types.length);
  await expect
    .poll(async () => (await persistedQueue(page, fixtureId)).map((item) => item.event.eventId), {
      timeout: 15000,
    })
    .toEqual(ids);
  return ids;
}
export type ScoringObservation = (
  kind: "ball" | "correction",
  commit: () => Promise<void>,
) => Promise<void>;
async function observeCommit(
  observe: ScoringObservation | undefined,
  kind: "ball" | "correction",
  commit: () => Promise<void>,
) {
  if (observe) await observe(kind, commit);
  else await commit();
}
export async function runBall(
  page: Page,
  runs = 0,
  shot = false,
  review?: () => Promise<void>,
  observe?: ScoringObservation,
) {
  await observeCommit(observe, "ball", () => page.getByTestId(`pad-run-${runs}`).click());
  if (runs === 4 || runs === 6) {
    const dialog = page.getByRole("dialog", { name: "Where did it go?", exact: true });
    await expect(dialog).toBeVisible();
    await review?.();
    const commit = () =>
      dialog.getByRole("button", { name: shot ? "cover" : "Skip", exact: true }).click();
    if (shot) await observeCommit(observe, "correction", commit);
    else await commit();
  }
}
export async function nextBowler(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name: "Who bowls the next over?", exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: new RegExp(`^${name} `) })
    .and(dialog.locator("button[aria-pressed]"))
    .click();
  await dialog.getByRole("button", { name: `${name} to bowl`, exact: true }).click();
}
/**
 * Open an exact pad address while offline. The worker answers it with the
 * data-free shell (`/score/shell#<id>`); Chromium proves that redirect. In
 * Firefox and WebKit Playwright's offline switch does not reach the worker's
 * own fetch, so the server would answer instead; there the test opens the
 * shell address the worker sends it to, and everything after still runs.
 */
export async function openPadOffline(page: Page, fixtureId: string, browserName: string) {
  if (browserName === "chromium") {
    await page.goto(`/score/${fixtureId}`);
    await expect(page).toHaveURL(`/score/shell#${fixtureId}`);
  } else {
    await page.goto(`/score/shell#${fixtureId}`);
  }
}

export async function readyOffline(page: Page, fixtureId: string) {
  await sent(page);
  await page.goto("/score");
  await page.getByRole("button", { name: "Get ready for match day", exact: true }).click();
  await expect(page.getByText("✓ Works offline", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.goto(`/score/${fixtureId}`);
  await expect(page.getByTestId("pad-run-0")).toBeEnabled();
}

export async function firstScoringOver(
  page: Page,
  fixture: ScoringFixture,
  review?: () => Promise<void>,
  observe?: ScoringObservation,
) {
  await page.getByTestId("pad-mod-wide").click();
  await runBall(page, 2, false, undefined, observe);
  await page.getByTestId("pad-mod-noball").click();
  await runBall(page, 4, true, review, observe);
  await expect(page.getByText("Free hit", { exact: true })).toBeVisible();
  await page.getByTestId("pad-mod-legbye").click();
  await runBall(page, 1, false, undefined, observe);
  await page.getByTestId("pad-wicket").click();
  const wicket = page.getByRole("dialog", { name: "Wicket", exact: true });
  await wicket.getByRole("button", { name: "Caught", exact: true }).click();
  await wicket.getByRole("button", { name: fixture.awayNames[7]!, exact: true }).click();
  await wicket
    .getByRole("button", { name: "Place optional fielding pin", exact: true })
    .click({ position: { x: 80, y: 80 } });
  await review?.();
  await observeCommit(observe, "ball", () =>
    wicket.getByRole("button", { name: "Confirm wicket", exact: true }).click(),
  );
  await page.getByTestId("pad-wicket").click();
  await wicket.getByRole("button", { name: "Run out", exact: true }).click();
  await review?.();
  await observeCommit(observe, "ball", () =>
    wicket.getByRole("button", { name: "Confirm wicket", exact: true }).click(),
  );
  await runBall(page, 4, true, review, observe);
  await runBall(page, 0, false, undefined, observe);
  await sent(page);
  await observeCommit(observe, "correction", () => page.getByTestId("pad-undo").click());
  await sent(page);
  await page.getByRole("button", { name: "Edit delivery 0.4", exact: true }).click();
  const edit = page.getByRole("dialog", { name: /Edit delivery/ });
  await edit.getByRole("button", { name: "6", exact: true }).click();
  await review?.();
  await observeCommit(observe, "correction", () =>
    edit.getByRole("button", { name: "Save correction", exact: true }).click(),
  );
  await runBall(page, 0, false, undefined, observe);
  await runBall(page, 0, false, undefined, observe);
  await sent(page);
  await expect(page.getByTestId("pad-score")).toHaveText("15/2");
  const bowlers = page.getByRole("dialog", { name: "Who bowls the next over?", exact: true });
  await expect(bowlers.getByRole("button", { name: /^Away player 1 / })).toBeDisabled();
  await review?.();
}

/** A published follow-up with the same real registrations; accepted history is never seeded. */
export async function followupScoringFixture(
  source: ScoringFixture,
  seq: number,
  options: { sameDay?: boolean } = {},
): Promise<ScoringFixture> {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const [original] = await handle.db
      .select()
      .from(fixtures)
      .where(eq(fixtures.id, source.fixtureId));
    if (!original) throw new Error("Missing source fixture");
    const fixtureId = newId();
    await handle.db.insert(fixtures).values({
      id: fixtureId,
      orgId: original.orgId,
      competitionId: original.competitionId,
      homeTeamId: source.homeId,
      awayTeamId: source.awayId,
      fixtureNumber: `Match ${String(seq)}`,
      seq,
      ...(options.sameDay ? { kickoffAt: original.kickoffAt } : {}),
      status: "published",
      publishedAt: new Date(),
      createdBy: source.actorId,
    });
    await handle.db.insert(fixtureLineups).values(
      [...source.homePlayers, ...source.awayPlayers].map((registrationId, index) => ({
        fixtureId,
        registrationId,
        teamId: index < 11 ? source.homeId : source.awayId,
        orgId: original.orgId,
        competitionId: original.competitionId,
        recordedBy: source.actorId,
        createdAt: new Date(Date.now() + index),
      })),
    );
    return { ...source, fixtureId };
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}
export async function startAwayScoring(page: Page, fixture: ScoringFixture) {
  await scoringSession(page.context(), fixture.actorToken);
  await page.goto(`/score/${fixture.fixtureId}/setup`);
  await page.getByRole("button", { name: "Looks right Confirm conditions", exact: true }).click();
  await page.getByRole("button", { name: "Both XIs ready Next: toss", exact: true }).click();
  await page.getByTestId(`toss-winner-${fixture.awayId}`).click();
  await page.getByTestId("setup-start").click();
  await page.waitForURL(`**/score/${fixture.fixtureId}`);
  await expect(page.getByTestId("pad-run-0")).toBeEnabled();
}

/** Observe the real on-demand writer, without inserting or changing award evidence. */
export async function readSeasonAwards(fixtureId: string) {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const [fixture] = await handle.db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture) throw new Error("Missing fixture");
    return await handle.db
      .select()
      .from(matchAwards)
      .where(
        and(eq(matchAwards.competitionId, fixture.competitionId), eq(matchAwards.scope, "season")),
      );
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}
