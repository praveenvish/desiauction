// POSTER ACCESS REGRESSION SUITE.
//
// Posters are the first authorization in this product that is not "what key do
// you hold" but "who are you to this row". `viewer` is the empty capability set,
// so a player and a team owner hold NOTHING — and the poster gate, written
// against `registration.review` alone, refused the two people the artefact
// exists for. Relationship access fixes that, and relationship access is exactly
// the kind that fails open if nobody writes down what it must refuse.
//
// So the refusals are the point of this file. A player who can reach their own
// card is one query away from reaching everybody's: the id is in their own URL
// and the next one is a guess.
import { registrationNumber, DEFAULT_AUCTION_CONFIG } from "@desiauction/core";
import {
  auctionOwnerInvites,
  auctions as auctionsTable,
  auditLog,
  competitions as competitionsTable,
  createDb,
  grants as grantsTable,
  lots as lotsTable,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  paddles as paddlesTable,
  people,
  registrations as registrationsTable,
  sessions,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { createOrg } from "../orgs/orgs";
import { createCompetition, createTeam } from "./competitions";
import { playerPosterFor, posterGateFor, posterPickerFor, teamPosterFor } from "./posters";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_ORGANIZER = `+9198${RUN}1`;
const PHONE_STRANGER = `+9196${RUN}2`;
const TEST_PHONES = [PHONE_ORGANIZER, PHONE_STRANGER];
const SEED_PREFIX = `+91977${RUN}`;
const REQUEST = { theme: "floodlight", size: "square" } as const;

let organizer = "";
let stranger = "";
let org = { id: "", name: "", slug: "" };
let slug = "";
let compId = "";
let auctionId = "";
const seeded: string[] = [];

/** [teamId, ownerPersonId] for the two franchises. */
const alpha = { teamId: "", ownerId: "", paddleId: "" };
const beta = { teamId: "", ownerId: "", paddleId: "" };
/** The sold player, the unsold player, and one who never got a verdict. */
const sold = { personId: "", registrationId: "" };
const unsold = { personId: "", registrationId: "" };
const queued = { personId: "", registrationId: "" };

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, phone, row?.code ?? "");
  if (!verified.ok) {
    throw new Error(`login failed for ${phone}`);
  }
  return verified.personId;
}

/** A person with a phone and a name, but no session — most players never log in. */
async function person(name: string, suffix: string): Promise<string> {
  const id = newId();
  await db.insert(people).values({ id, phone: `${SEED_PREFIX}${suffix}`, name });
  seeded.push(id);
  return id;
}

async function register(personId: string, status = "approved"): Promise<string> {
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId: org.id,
    competitionId: compId,
    personId,
    role: "batter",
    status: status as "approved",
    registrationNumber: registrationNumber(id),
  });
  return id;
}

beforeAll(async () => {
  organizer = await login(PHONE_ORGANIZER);
  stranger = await login(PHONE_STRANGER);
  org = await createOrg(db, organizer, `Poster Org ${RUN}`);
  const competition = await createCompetition(db, org.id, organizer, {
    name: `Poster Cup ${RUN}`,
  });
  compId = competition.id;
  slug = competition.slug;

  for (const [name, team] of [
    ["Alpha XI", alpha],
    ["Beta United", beta],
  ] as const) {
    const created = await createTeam(db, org.id, compId, organizer, name);
    if (!created.ok) {
      throw new Error("team setup failed");
    }
    team.teamId = created.team.id;
  }

  auctionId = newId();
  await db.insert(auctionsTable).values({
    id: auctionId,
    orgId: org.id,
    competitionId: compId,
    name: `Poster Cup ${RUN} auction`,
    status: "completed",
    config: DEFAULT_AUCTION_CONFIG,
    createdBy: organizer,
  });

  // The two franchise owners. `acceptOwnerJoin` makes an accepted owner a
  // viewer-level member of the org, so the fixture does the same — the poster
  // gate's owner path deliberately requires membership, and a fixture that
  // skipped it would be testing a person who cannot exist.
  let paddleNumber = 1;
  for (const [name, team] of [
    ["Alpha Owner", alpha],
    ["Beta Owner", beta],
  ] as const) {
    team.ownerId = await person(name, String(paddleNumber));
    await db.insert(orgMembers).values({ orgId: org.id, personId: team.ownerId });
    team.paddleId = newId();
    await db.insert(paddlesTable).values({
      id: team.paddleId,
      orgId: org.id,
      auctionId,
      teamId: team.teamId,
      personId: team.ownerId,
      paddleNumber: String(paddleNumber),
    });
    paddleNumber += 1;
  }

  sold.personId = await person("Sold Player", "5");
  sold.registrationId = await register(sold.personId);
  unsold.personId = await person("Unsold Player", "6");
  unsold.registrationId = await register(unsold.personId);
  queued.personId = await person("Queued Player", "7");
  queued.registrationId = await register(queued.personId);

  const lots: [string, "sold" | "unsold" | "queued", number][] = [
    [sold.registrationId, "sold", 1],
    [unsold.registrationId, "unsold", 2],
    [queued.registrationId, "queued", 3],
  ];
  for (const [registrationId, status, seq] of lots) {
    await db.insert(lotsTable).values({
      id: newId(),
      orgId: org.id,
      auctionId,
      registrationId,
      lotNumber: String(seq),
      seq,
      basePrice: 5_000_000,
      status,
      ...(status === "sold" ? { soldToPaddleId: alpha.paddleId, soldPrice: 7_500_000 } : {}),
    });
  }
});

afterAll(async () => {
  const personIds = [organizer, stranger, ...seeded].filter((id) => id !== "");
  if (org.id !== "") {
    await db.delete(lotsTable).where(eq(lotsTable.orgId, org.id));
    await db.delete(paddlesTable).where(eq(paddlesTable.orgId, org.id));
    await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, org.id));
    await db.delete(auctionsTable).where(eq(auctionsTable.orgId, org.id));
    await db.delete(registrationsTable).where(eq(registrationsTable.orgId, org.id));
    await db.delete(teamsTable).where(eq(teamsTable.orgId, org.id));
    await db.delete(competitionsTable).where(eq(competitionsTable.orgId, org.id));
    await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
    await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
    await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  if (personIds.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, personIds));
    await db.delete(auditLog).where(inArray(auditLog.actor, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await handle.sql.end();
});

describe("POSTER ACCESS — the organizer keeps everything they had", () => {
  it("draws any player and any team, and the audit row says by what authority", async () => {
    const player = await playerPosterFor(organizer, slug, sold.registrationId, REQUEST);
    expect(player.ok).toBe(true);
    const team = await teamPosterFor(organizer, slug, beta.teamId, REQUEST);
    expect(team.ok).toBe(true);

    const [row] = await db
      .select({ meta: auditLog.meta, actor: auditLog.actor })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "registration.poster_generated"),
          eq(auditLog.subject, sold.registrationId),
        ),
      );
    expect(row?.actor).toBe(organizer);
    // An officer taking a copy of a civilian's face and that civilian taking a
    // copy of their own are the same row shape and not the same event.
    expect((row?.meta as { via?: string }).via).toBe("organizer");
  });

  it("lists the whole season in the picker", async () => {
    const picker = await posterPickerFor(organizer, slug);
    expect("ok" in picker).toBe(false);
    if ("ok" in picker) {
      return;
    }
    expect(picker.players.map((p) => p.id).sort()).toEqual(
      [sold.registrationId, unsold.registrationId, queued.registrationId].sort(),
    );
    expect(picker.teams).toHaveLength(2);
    // `season` scope: an empty side means the season HAS none, and the studio
    // may say "add a franchise" — advice only an organizer can act on.
    expect(picker.scope).toBe("season");
  });
});

describe("POSTER ACCESS — the player, their own card and NOTHING else", () => {
  it("draws their own card without holding a single capability", async () => {
    const own = await playerPosterFor(sold.personId, slug, sold.registrationId, REQUEST);
    expect(own.ok).toBe(true);
    if (!own.ok) {
      return;
    }
    expect(own.input.playerName).toBe("Sold Player");
    expect(own.input.pricePaise).toBe(7_500_000);

    const [row] = await db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "registration.poster_generated"),
          eq(auditLog.subject, sold.registrationId),
          eq(auditLog.actor, sold.personId),
        ),
      );
    expect((row?.meta as { via?: string }).via).toBe("self");
  });

  it("REFUSES another player's card — the id next to their own", async () => {
    const other = await playerPosterFor(sold.personId, slug, unsold.registrationId, REQUEST);
    expect(other).toMatchObject({ ok: false, status: 404 });
    // And no row was written for a poster that was never drawn.
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.subject, unsold.registrationId), eq(auditLog.actor, sold.personId)));
    expect(rows).toHaveLength(0);
  });

  it("REFUSES a team poster — a squad sheet is every teammate's price", async () => {
    expect(await teamPosterFor(sold.personId, slug, alpha.teamId, REQUEST)).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("shows the player exactly one subject and no teams", async () => {
    const picker = await posterPickerFor(unsold.personId, slug);
    expect("ok" in picker).toBe(false);
    if ("ok" in picker) {
      return;
    }
    // Narrowed by a PREDICATE: reading the season and then dropping the rows
    // that are not yours still reads them.
    expect(picker.players.map((p) => p.id)).toEqual([unsold.registrationId]);
    expect(picker.teams).toEqual([]);
    // `mine`: the empty side is "not yours", not "none exist" — the season has
    // two teams. The studio drops the kind selector rather than offering a
    // control whose only outcome is a dead end.
    expect(picker.scope).toBe("mine");
  });

  it("REFUSES a player whose night reached no verdict", async () => {
    // The gate lets them in — it is their registration — and the source then
    // refuses, because a poster asserts an outcome and "still in the queue" is
    // not one. `posterReady` on /home mirrors this so the door is never offered.
    const gate = await posterGateFor(queued.personId, slug);
    expect("ok" in gate).toBe(false);
    expect(
      await playerPosterFor(queued.personId, slug, queued.registrationId, REQUEST),
    ).toMatchObject({ ok: false, status: 404 });
  });
});

describe("POSTER ACCESS — the owner, their own squad and NOTHING else", () => {
  it("draws their own squad sheet, priced, and records it as the owner's act", async () => {
    const own = await teamPosterFor(alpha.ownerId, slug, alpha.teamId, REQUEST);
    expect(own.ok).toBe(true);
    if (!own.ok) {
      return;
    }
    expect(own.input.teamName).toBe("Alpha XI");
    expect(own.input.members.map((m) => m.name)).toContain("Sold Player");

    const [row] = await db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.action, "team.poster_generated"), eq(auditLog.actor, alpha.ownerId)));
    expect((row?.meta as { via?: string }).via).toBe("owner");
  });

  it("REFUSES a RIVAL's squad — the roster and every price DA-30 withholds", async () => {
    expect(await teamPosterFor(alpha.ownerId, slug, beta.teamId, REQUEST)).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("REFUSES a player card, including one of their own signings", async () => {
    // The owner bought this player and knows the price. They still do not get to
    // publish that person's face — that grant belongs to the person on it.
    expect(await playerPosterFor(alpha.ownerId, slug, sold.registrationId, REQUEST)).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("shows the owner one team and no players", async () => {
    const picker = await posterPickerFor(beta.ownerId, slug);
    expect("ok" in picker).toBe(false);
    if ("ok" in picker) {
      return;
    }
    expect(picker.teams.map((t) => t.id)).toEqual([beta.teamId]);
    expect(picker.players).toEqual([]);
    expect(picker.scope).toBe("mine");
  });

  it("a RELEASED paddle is not ownership; a REVOKED invitation is not either", async () => {
    await db
      .update(paddlesTable)
      .set({ releasedAt: new Date() })
      .where(eq(paddlesTable.id, beta.paddleId));
    expect(await posterGateFor(beta.ownerId, slug)).toMatchObject({ ok: false, status: 403 });

    // An invitation they accepted and the organizer then revoked grants nothing
    // either — the Teams card can afford to keep printing a name that was once
    // real; an authorization cannot.
    await db.insert(auctionOwnerInvites).values({
      id: newId(),
      orgId: org.id,
      auctionId,
      teamId: beta.teamId,
      tokenHash: `revoked-${RUN}`,
      createdBy: organizer,
      expiresAt: new Date(Date.now() + 86_400_000),
      acceptedBy: beta.ownerId,
      acceptedAt: new Date(),
      revokedAt: new Date(),
    });
    expect(await posterGateFor(beta.ownerId, slug)).toMatchObject({ ok: false, status: 403 });

    // Un-revoked, the same invitation restores the grant — proving the refusal
    // above was the revocation and not the fixture.
    await db
      .update(auctionOwnerInvites)
      .set({ revokedAt: null })
      .where(eq(auctionOwnerInvites.tokenHash, `revoked-${RUN}`));
    expect(await teamPosterFor(beta.ownerId, slug, beta.teamId, REQUEST)).toMatchObject({
      ok: true,
    });
  });
});

describe("POSTER ACCESS — everyone else", () => {
  it("tells a STRANGER nothing, with a 404 rather than a 403", async () => {
    // Whether this org runs a season called `mumbai-corporate-2026` is not a
    // fact an outsider gets to confirm by reading a status code.
    expect(await posterGateFor(stranger, slug)).toMatchObject({ ok: false, status: 404 });
    expect(await playerPosterFor(stranger, slug, sold.registrationId, REQUEST)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await teamPosterFor(stranger, slug, alpha.teamId, REQUEST)).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("tells a MEMBER with no key and no relationship 403 — they can see the season exists", async () => {
    const bystander = await person("Club Bystander", "9");
    await db.insert(orgMembers).values({ orgId: org.id, personId: bystander });
    expect(await posterGateFor(bystander, slug)).toMatchObject({ ok: false, status: 403 });
  });

  it("does not carry one season's grant into another", async () => {
    /*
     * The competition predicate on the relationship read is a tenant binding,
     * not a filter. Asserting only the 404 would prove nothing here: the DATA
     * read carries its own binding, so removing this one leaves the refusal
     * intact and the test green while the GRANT has silently widened to every
     * season the person ever played in. So the grant is asserted directly —
     * that is the thing that must stay narrow, and the 404 is downstream of it.
     */
    const second = await createCompetition(db, org.id, organizer, { name: `Poster Cup B ${RUN}` });
    const gate = await posterGateFor(sold.personId, second.slug);
    // No registration in THAT season, so nothing is granted and the refusal is
    // the outsider's 404 rather than a grant that happens not to resolve.
    expect(gate).toMatchObject({ ok: false, status: 404 });
    expect(
      await playerPosterFor(sold.personId, second.slug, sold.registrationId, REQUEST),
    ).toMatchObject({ ok: false, status: 404 });

    // And with a registration in the second season, the grant names THAT one
    // and not the first — the proof the predicate binds rather than merely
    // filters something the next query would have caught anyway.
    const alsoHere = newId();
    await db.insert(registrationsTable).values({
      id: alsoHere,
      orgId: org.id,
      competitionId: second.id,
      personId: sold.personId,
      role: "batter",
      status: "approved",
      registrationNumber: registrationNumber(alsoHere),
    });
    const widened = await posterGateFor(sold.personId, second.slug);
    expect("ok" in widened).toBe(false);
    if (!("ok" in widened)) {
      expect(widened.grant.ownRegistrationIds).toEqual([alsoHere]);
    }
    await db.delete(registrationsTable).where(eq(registrationsTable.id, alsoHere));
    await db.delete(competitionsTable).where(eq(competitionsTable.id, second.id));
  });
});
