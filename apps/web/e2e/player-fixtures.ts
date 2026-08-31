import {
  auctions,
  competitions,
  createDb,
  lots,
  newId,
  organizations,
  people,
  registrations,
  teams,
} from "@desiauction/db";
import { eq } from "drizzle-orm";

/**
 * Direct-DB fixtures for the PI-1 e2e journeys (the demo-availability.ts
 * pattern: rows the UI cannot mint quickly enough for a test to stay honest
 * about what it is testing). Per-call connections, like e2e/otp.ts — Playwright
 * workers have no teardown hook for a module-level pool.
 *
 * Rows are stamped with unique names per run; the dev DB is not idempotent by
 * design (documented residue posture), and every id is unique per run.
 */

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";

export async function personIdByPhone(phone: string): Promise<string> {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const [row] = await handle.db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, phone))
      .limit(1);
    if (row === undefined) {
      throw new Error(`no person for ${phone} — log in first, the person is minted at verify`);
    }
    return row.id;
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

/** A settled-looking season for one person: approved registration, a completed
 * auction, a SOLD lot at a known price — what /me/cricket exists to render. */
export async function insertCareerFixture(
  personId: string,
  stamp: string,
): Promise<{ competitionName: string; soldPriceLabel: string }> {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const db = handle.db;
    const orgId = newId();
    const competitionId = newId();
    const teamId = newId();
    const registrationId = newId();
    const auctionId = newId();
    const competitionName = `Career Fixture Cup ${stamp}`;
    await db.insert(organizations).values({
      id: orgId,
      name: `Career Fixture Org ${stamp}`,
      slug: `career-fixture-org-${stamp}`,
      createdBy: personId,
    });
    await db.insert(competitions).values({
      id: competitionId,
      orgId,
      name: competitionName,
      slug: `career-fixture-cup-${stamp}`,
      status: "registration_closed",
      startsOn: "2025-11-01",
      createdBy: personId,
    });
    await db.insert(teams).values({
      id: teamId,
      orgId,
      competitionId,
      name: `Fixture Strikers ${stamp}`,
      createdBy: personId,
    });
    await db.insert(registrations).values({
      id: registrationId,
      orgId,
      competitionId,
      personId,
      role: "all_rounder",
      status: "approved",
      registrationNumber: `R${stamp.slice(0, 6)}`,
      teamId,
    });
    await db.insert(auctions).values({
      id: auctionId,
      orgId,
      competitionId,
      name: `${competitionName} Auction`,
      status: "completed",
      config: {},
      createdBy: personId,
    });
    await db.insert(lots).values({
      id: newId(),
      orgId,
      auctionId,
      registrationId,
      lotNumber: "L001",
      seq: 1,
      basePrice: 10_000_00,
      status: "sold",
      soldToPaddleId: newId(),
      soldPrice: 3_50_000_00, // ₹3,50,000
    });
    return { competitionName, soldPriceLabel: "₹3,50,000" };
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

/** A women's season with registration open — the eligibility journey's stage. */
export async function insertWomensSeason(stamp: string): Promise<{ registerPath: string }> {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const db = handle.db;
    const orgId = newId();
    const competitionId = newId();
    const slug = `womens-fixture-cup-${stamp}`;
    const creator = newId();
    await db.insert(people).values({ id: creator, phone: `+9181${stamp}`, name: "Fixture Org" });
    await db.insert(organizations).values({
      id: orgId,
      name: `Womens Fixture Org ${stamp}`,
      slug: `womens-fixture-org-${stamp}`,
      createdBy: creator,
    });
    await db.insert(competitions).values({
      id: competitionId,
      orgId,
      name: `Womens Fixture Cup ${stamp}`,
      slug,
      status: "registration_open",
      entryCategory: "women",
      location: "Malad, Mumbai",
      startsOn: "2026-10-01",
      endsOn: "2026-10-20",
      createdBy: creator,
    });
    return { registerPath: `/seasons/${slug}/register` };
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}
