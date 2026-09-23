// A REGISTRATION'S LIFECYCLE AGAINST THE SQUAD, against real Postgres.
//
// The go-live gate (2026-09-23) found the registration aggregate changing a
// status and nothing else: a withdrawn captain kept their team and armband,
// the squad counts went on counting them while the squad sheets did not, an
// organizer could withdraw a player the auction had already sold, and two
// decisions on one row both "succeeded". Each case below is one of those, held.
import {
  DEFAULT_AUCTION_CONFIG,
  parseRegistrationCsv,
  registrationNumber,
} from "@desiauction/core";
import {
  auctions as auctionsTable,
  auditLog,
  createDb,
  newId,
  people,
  registrations as registrationsTable,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { captainLockRefusal } from "./captain-lock";
import { createCompetition, createTeam, type CompetitionSummary } from "./competitions";
import {
  addNote,
  assignTeam,
  setRegistrationMarks,
  transition,
  transitionBatch,
} from "./registration-aggregate";
import { commitRegistrationImport, RosterFieldImportRefused } from "./registration-import";
import { squadSheetsView } from "./squad-sheets";
import { squadSizes, teamsBelowSquadMin } from "./squad-projection";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-6);

let owner = "";
let orgId = "";
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let other: CompetitionSummary = null as unknown as CompetitionSummary;
let teamId = "";
let otherTeamId = "";
const personIds: string[] = [];
let phoneSeq = 10;

async function seed(
  competitionId: string,
  name: string,
  status: "submitted" | "approved" | "rejected" = "approved",
  extra: Partial<typeof registrationsTable.$inferInsert> = {},
): Promise<string> {
  const personId = newId();
  phoneSeq += 1;
  await db.insert(people).values({ id: personId, phone: `+9192${RUN}${String(phoneSeq)}`, name });
  personIds.push(personId);
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId,
    competitionId,
    personId,
    role: "batter",
    status,
    registrationNumber: registrationNumber(id),
    ...extra,
  });
  return id;
}

async function rowOf(id: string) {
  const [row] = await db
    .select({
      status: registrationsTable.status,
      teamId: registrationsTable.teamId,
      isIcon: registrationsTable.isIcon,
      isCaptain: registrationsTable.isCaptain,
      isRetained: registrationsTable.isRetained,
    })
    .from(registrationsTable)
    .where(eq(registrationsTable.id, id));
  return row;
}

/** Put the season's auction past `scheduled` — the roster lock — and back. */
async function withAuction<T>(status: "live" | "scheduled", body: () => Promise<T>): Promise<T> {
  const id = newId();
  await db.insert(auctionsTable).values({
    id,
    orgId,
    competitionId: comp.id,
    name: `Lock ${RUN}`,
    status,
    config: DEFAULT_AUCTION_CONFIG,
    createdBy: owner,
  });
  try {
    return await body();
  } finally {
    await db.delete(auctionsTable).where(eq(auctionsTable.id, id));
  }
}

beforeAll(async () => {
  owner = newId();
  await db.insert(people).values({ id: owner, phone: `+9192${RUN}00`, name: "Organizer" });
  orgId = (await createOrg(db, owner, `Lifecycle Club ${RUN}`)).id;
  const season = (name: string) =>
    createCompetition(db, orgId, owner, {
      sport: "cricket",
      name,
      location: "Pune",
      startsOn: "2026-10-01",
      endsOn: "2026-10-30",
    });
  comp = await season(`Lifecycle Cup ${RUN}`);
  other = await season(`Other Cup ${RUN}`);
  const team = await createTeam(db, orgId, comp.id, owner, `Lifecycle XI ${RUN}`);
  const foreign = await createTeam(db, orgId, other.id, owner, `Other XI ${RUN}`);
  if (!team.ok || !foreign.ok) throw new Error("team setup failed");
  teamId = team.team.id;
  otherTeamId = foreign.team.id;
});

afterAll(async () => {
  if (orgId !== "") {
    await purgeOrg(db, orgId);
  }
  const everyone = [owner, ...personIds].filter((id) => id !== "");
  await db.delete(auditLog).where(inArray(auditLog.actor, everyone));
  await db.delete(people).where(inArray(people.id, everyone));
  await handle.sql.end();
});

describe("P1-9 — a player who leaves the season leaves their squad", () => {
  it("withdrawing a pre-signed captain clears the team and every mark, and the counts agree", async () => {
    const captain = await seed(comp.id, "Walking Captain");
    expect(
      await setRegistrationMarks(db, orgId, comp.id, captain, { isCaptain: true, teamId }, owner),
    ).toEqual({ ok: true });
    expect((await squadSizes(db, comp.id)).get(teamId)?.size).toBe(1);

    expect(await transition(db, orgId, comp.id, captain, owner, { type: "withdraw" })).toEqual({
      ok: true,
      status: "withdrawn",
    });
    expect(await rowOf(captain)).toEqual({
      status: "withdrawn",
      teamId: null,
      isIcon: false,
      isCaptain: false,
      isRetained: false,
    });
    // The squad count and the squad sheet now tell the same story: nobody.
    expect((await squadSizes(db, comp.id)).get(teamId)).toBeUndefined();
    const sheet = await squadSheetsView(db, comp.id);
    expect(sheet.pending + sheet.sent).toBe(0);
    expect(await teamsBelowSquadMin(db, comp.id, 1)).toBe(1);
  });

  it("rejecting clears them the same way, on the bulk path too", async () => {
    const icon = await seed(comp.id, "Rejected Icon", "submitted", { isIcon: true, teamId });
    const result = await transitionBatch(db, orgId, comp.id, [icon], owner, {
      type: "reject",
      reason: "capacity",
    });
    expect(result.applied).toEqual([icon]);
    expect(await rowOf(icon)).toMatchObject({ status: "rejected", teamId: null, isIcon: false });
  });

  it("a row that kept its team from before the fix is not counted in the squad", async () => {
    // Stale state written straight to the table, as rows from before this fix are.
    await seed(comp.id, "Stale Leaver", "rejected", { teamId, isRetained: true });
    expect((await squadSizes(db, comp.id)).get(teamId)).toBeUndefined();
    expect(await teamsBelowSquadMin(db, comp.id, 1)).toBe(1);
  });

  it("refuses to pre-sign a player who is not approved, and still lets a mark be cleared", async () => {
    const pending = await seed(comp.id, "Not Yet Approved", "submitted");
    expect(
      await setRegistrationMarks(db, orgId, comp.id, pending, { isCaptain: true, teamId }, owner),
    ).toEqual({ ok: false, reason: "not_approved" });
    expect(await assignTeam(db, orgId, comp.id, pending, teamId, owner)).toEqual({
      ok: false,
      reason: "not_approved",
    });
    expect(
      await setRegistrationMarks(db, orgId, comp.id, pending, { isIcon: false }, owner),
    ).toEqual({ ok: true });
    expect(await rowOf(pending)).toMatchObject({ teamId: null, isCaptain: false });
  });
});

describe("P2 — the organizer's withdraw obeys the roster lock", () => {
  it("refuses to withdraw an approved player once the auction has opened, single and bulk", async () => {
    const sold = await seed(comp.id, "Sold Player", "approved", { teamId });
    const applicant = await seed(comp.id, "Late Applicant", "submitted");
    await withAuction("live", async () => {
      expect(await transition(db, orgId, comp.id, sold, owner, { type: "withdraw" })).toEqual({
        ok: false,
        reason: "roster_locked",
      });
      const bulk = await transitionBatch(db, orgId, comp.id, [sold, applicant], owner, {
        type: "withdraw",
      });
      // The applicant was never in the pool the auction settled; they may go.
      expect(bulk.applied).toEqual([applicant]);
      expect(bulk.skipped).toEqual([{ id: sold, reason: "roster_locked" }]);
    });
    // The sold player's team is the auction's truth, and it is untouched.
    expect(await rowOf(sold)).toMatchObject({ status: "approved", teamId });
  });

  it("still allows it while the auction is only scheduled", async () => {
    const early = await seed(comp.id, "Early Leaver");
    await withAuction("scheduled", async () => {
      expect(await transition(db, orgId, comp.id, early, owner, { type: "withdraw" })).toEqual({
        ok: true,
        status: "withdrawn",
      });
    });
  });
});

describe("P2 — a decision lands only on the state it was made about", () => {
  it("of six concurrent decisions on one row, exactly one commits and is audited", async () => {
    const contested = await seed(comp.id, "Contested Row", "submitted");
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        transition(
          db,
          orgId,
          comp.id,
          contested,
          owner,
          index % 2 === 0 ? { type: "approve" } : { type: "reject", reason: "capacity" },
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const audited = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.subject, contested),
          inArray(auditLog.action, ["registration.approve", "registration.reject"]),
        ),
      );
    expect(audited).toHaveLength(1);
  });
});

describe("P2 — an import cannot change role or band once the auction has opened", () => {
  it("refuses the whole file, as the single-row edit does", async () => {
    const phone = `9${RUN}777`;
    const first = parseRegistrationCsv(`name,phone,role\nRole Changer,${phone},batter`);
    expect(first.errors).toEqual([]);
    await commitRegistrationImport(db, comp.id, orgId, owner, first.rows);
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, `+91${phone}`));
    personIds.push(person?.id ?? "");

    const second = parseRegistrationCsv(`name,phone,role\nRole Changer,${phone},bowler`);
    expect(second.errors).toEqual([]);
    await expect(
      commitRegistrationImport(db, comp.id, orgId, owner, second.rows, "file-wins", newId()),
    ).rejects.toBeInstanceOf(RosterFieldImportRefused);
    const [row] = await db
      .select({ role: registrationsTable.role })
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.competitionId, comp.id),
          eq(registrationsTable.personId, person?.id ?? ""),
        ),
      );
    expect(row?.role).toBe("batter");
  });
});

describe("P3 — every write is bound to the season it was authorized for", () => {
  it("refuses a team from another season", async () => {
    const player = await seed(comp.id, "Wrong Team Target");
    expect(
      await setRegistrationMarks(db, orgId, comp.id, player, { teamId: otherTeamId }, owner),
    ).toEqual({ ok: false, reason: "unknown_team" });
    expect(await assignTeam(db, orgId, comp.id, player, otherTeamId, owner)).toEqual({
      ok: false,
      reason: "unknown_team",
    });
    expect((await rowOf(player))?.teamId).toBeNull();
  });

  it("writes no audit row for a team assignment that matched nothing", async () => {
    const elsewhere = await seed(other.id, "Other Season Player");
    expect(await assignTeam(db, orgId, comp.id, elsewhere, null, owner)).toEqual({
      ok: false,
      reason: "not_found",
    });
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.subject, elsewhere));
    expect(rows).toEqual([]);
  });

  it("refuses a note on another season's registration", async () => {
    const elsewhere = await seed(other.id, "Noted Elsewhere");
    expect(await addNote(db, orgId, comp.id, elsewhere, owner, "not yours")).toEqual({ ok: false });
    expect(await addNote(db, orgId, other.id, elsewhere, owner, "yours")).toEqual({ ok: true });
  });

  it("the captain rule answers nothing for a player outside the auction's season", async () => {
    const elsewhere = await seed(other.id, "Captain Elsewhere");
    const auctionId = newId();
    await db.insert(auctionsTable).values({
      id: auctionId,
      orgId,
      competitionId: comp.id,
      name: `Captain ${RUN}`,
      status: "live",
      config: DEFAULT_AUCTION_CONFIG,
      createdBy: owner,
    });
    try {
      // Unbound, this read "not_in_squad" off a player the auction never had.
      expect(await captainLockRefusal(db, auctionId, elsewhere, true)).toBeNull();
    } finally {
      await db.delete(auctionsTable).where(eq(auctionsTable.id, auctionId));
    }
  });
});
