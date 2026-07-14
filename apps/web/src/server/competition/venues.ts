import {
  isGroundStatus,
  isGroundSurface,
  validateName,
  type GroundStatus,
  type GroundSurface,
} from "@desiauction/core";
import { auditLog, grounds, newId, venues, type Db } from "@desiauction/db";
import { and, asc, eq } from "drizzle-orm";

// The Venue aggregate (M-IP3-3): physical locations, org-owned. Venue → Ground
// is the only hierarchy; fixtures reference grounds, so venue information is
// never duplicated. All rules come from core; this module fetches/writes and
// writes audit. Web actions are the only callers.

export interface GroundSummary {
  id: string;
  venueId: string;
  name: string;
  surface: GroundSurface;
  capacity: number | null;
  floodlights: boolean;
  indoor: boolean;
  status: GroundStatus;
}

export interface VenueSummary {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  grounds: GroundSummary[];
}

export type CreateVenueResult =
  | { ok: true; venue: { id: string; name: string } }
  | { ok: false; reason: "invalid_name" | "duplicate_name" };

export async function createVenue(
  db: Db,
  orgId: string,
  personId: string,
  name: string,
  address?: string,
  city?: string,
): Promise<CreateVenueResult> {
  const valid = validateName(name);
  if (!valid.ok) {
    return { ok: false, reason: "invalid_name" };
  }
  const id = newId();
  try {
    await db.insert(venues).values({
      id,
      orgId,
      name: valid.value,
      ...(address !== undefined && address !== "" ? { address } : {}),
      ...(city !== undefined && city !== "" ? { city } : {}),
      createdBy: personId,
    });
  } catch {
    // Unique (org_id, name) — venue information exists exactly once per org.
    return { ok: false, reason: "duplicate_name" };
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "venue.created",
    scopeType: "org",
    scopeId: orgId,
    subject: id,
    meta: { name: valid.value },
  });
  return { ok: true, venue: { id, name: valid.value } };
}

export interface NewGround {
  name: string;
  surface?: string;
  capacity?: number;
  floodlights?: boolean;
  indoor?: boolean;
}

export type CreateGroundResult =
  | { ok: true; ground: { id: string; name: string } }
  | {
      ok: false;
      reason: "invalid_name" | "duplicate_name" | "invalid_surface" | "venue_not_found";
    };

export async function createGround(
  db: Db,
  orgId: string,
  venueId: string,
  personId: string,
  input: NewGround,
): Promise<CreateGroundResult> {
  const valid = validateName(input.name);
  if (!valid.ok) {
    return { ok: false, reason: "invalid_name" };
  }
  const surface = input.surface ?? "turf";
  if (!isGroundSurface(surface)) {
    return { ok: false, reason: "invalid_surface" };
  }
  // Tenant safety: the venue must belong to THIS org.
  const [venue] = await db
    .select({ id: venues.id })
    .from(venues)
    .where(and(eq(venues.id, venueId), eq(venues.orgId, orgId)))
    .limit(1);
  if (venue === undefined) {
    return { ok: false, reason: "venue_not_found" };
  }
  const id = newId();
  try {
    await db.insert(grounds).values({
      id,
      orgId,
      venueId,
      name: valid.value,
      surface,
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      floodlights: input.floodlights ?? false,
      indoor: input.indoor ?? false,
      createdBy: personId,
    });
  } catch {
    // Unique (venue_id, name) — ground names are unique within a venue.
    return { ok: false, reason: "duplicate_name" };
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "ground.created",
    scopeType: "org",
    scopeId: orgId,
    subject: id,
    meta: { venueId, name: valid.value },
  });
  return { ok: true, ground: { id, name: valid.value } };
}

export type GroundStatusResult =
  { ok: true } | { ok: false; reason: "invalid_status" | "not_found" };

/** Availability engine input: an unavailable ground disappears from pickers. */
export async function setGroundStatus(
  db: Db,
  orgId: string,
  groundId: string,
  personId: string,
  status: string,
): Promise<GroundStatusResult> {
  if (!isGroundStatus(status)) {
    return { ok: false, reason: "invalid_status" };
  }
  const updated = await db
    .update(grounds)
    .set({ status })
    .where(and(eq(grounds.id, groundId), eq(grounds.orgId, orgId)))
    .returning({ id: grounds.id });
  if (updated.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "ground.status_changed",
    scopeType: "org",
    scopeId: orgId,
    subject: groundId,
    meta: { status },
  });
  return { ok: true };
}

/** An org's venues with their grounds, stable-ordered (name, then id). */
export async function venuesOf(db: Db, orgId: string): Promise<VenueSummary[]> {
  const [venueRows, groundRows] = await Promise.all([
    db
      .select({ id: venues.id, name: venues.name, address: venues.address, city: venues.city })
      .from(venues)
      .where(eq(venues.orgId, orgId))
      .orderBy(asc(venues.name), asc(venues.id)),
    db
      .select({
        id: grounds.id,
        venueId: grounds.venueId,
        name: grounds.name,
        surface: grounds.surface,
        capacity: grounds.capacity,
        floodlights: grounds.floodlights,
        indoor: grounds.indoor,
        status: grounds.status,
      })
      .from(grounds)
      .where(eq(grounds.orgId, orgId))
      .orderBy(asc(grounds.name), asc(grounds.id)),
  ]);
  return venueRows.map((venue) => ({
    ...venue,
    grounds: groundRows.filter((ground) => ground.venueId === venue.id),
  }));
}

export interface GroundOption {
  id: string;
  name: string;
  venueId: string;
  venueName: string;
  status: GroundStatus;
}

/** Flat picker list of ACTIVE grounds for scheduling (availability-filtered). */
export async function activeGroundsOf(db: Db, orgId: string): Promise<GroundOption[]> {
  return db
    .select({
      id: grounds.id,
      name: grounds.name,
      venueId: grounds.venueId,
      venueName: venues.name,
      status: grounds.status,
    })
    .from(grounds)
    .innerJoin(venues, eq(venues.id, grounds.venueId))
    .where(and(eq(grounds.orgId, orgId), eq(grounds.status, "active")))
    .orderBy(asc(venues.name), asc(grounds.name), asc(grounds.id));
}
