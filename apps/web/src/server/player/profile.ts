import {
  competitions,
  newId,
  passkeyCredentials,
  people,
  playerProfiles,
  playerSportProfiles,
  registrations,
  withTenantDb,
} from "@desiauction/db";
import { profileCompleteness, type Gender, type ProfileCompleteness } from "@desiauction/core";
import { and, asc, eq } from "drizzle-orm";

import { dbHandle } from "../db";
import { logSecurityEvent } from "../auth/security-events";

/**
 * THE PERSON-LEVEL CRICKET PROFILE (PI-1).
 *
 * Self-scoped by construction: every function takes the personId its caller
 * read from the session, and nothing here accepts a person id from a form.
 * The table carries no RLS (platform-to-person, like `people` and `sessions`),
 * so this module's discipline IS the lock — held by the person-isolation
 * regression test beside it.
 *
 * This is the source of registration DEFAULTS, never the per-season record:
 * the register wizard prefills from here and writes its own snapshot onto the
 * registration, so a later profile edit never rewrites history.
 */
/**
 * THE PERSON (SP-1 Phase 3).
 *
 * Everything here is true of somebody whatever they play. How they PLAY —
 * their role, their batting style, their preferred foot — moved to
 * `SportProfile` below, because a person can be an all-rounder at cricket and
 * a goalkeeper at football and one row could only ever hold one answer.
 */
export interface PlayerProfile {
  gender: Gender | null;
  genderSelfDescribed: string | null;
  dateOfBirth: string | null;
  location: string | null;
  preferredJerseyName: string | null;
  preferredJerseyNumber: string | null;
}

export const EMPTY_PLAYER_PROFILE: PlayerProfile = {
  gender: null,
  genderSelfDescribed: null,
  dateOfBirth: null,
  location: null,
  preferredJerseyName: null,
  preferredJerseyNumber: null,
};

/**
 * THE PLAYER, IN ONE SPORT.
 *
 * `attributes` is keyed by the pack's own attribute keys — `batting_style` and
 * `bowling_style` for cricket, `preferred_foot` for football — so a new sport
 * adds a pack file and nothing else.
 */
export interface SportProfile {
  sport: string;
  defaultRole: string | null;
  attributes: Record<string, string>;
}

export const emptySportProfile = (sport: string): SportProfile => ({
  sport,
  defaultRole: null,
  attributes: {},
});

/** The profile, or the empty shape — absence of a row IS the empty state. */
export async function playerProfileFor(personId: string): Promise<PlayerProfile> {
  const [row] = await dbHandle.db
    .select()
    .from(playerProfiles)
    .where(eq(playerProfiles.personId, personId))
    .limit(1);
  if (row === undefined) {
    return EMPTY_PLAYER_PROFILE;
  }
  return {
    gender: row.gender,
    genderSelfDescribed: row.genderSelfDescribed,
    dateOfBirth: row.dateOfBirth,
    location: row.location,
    preferredJerseyName: row.preferredJerseyName,
    preferredJerseyNumber: row.preferredJerseyNumber,
  };
}

/** How this person plays one sport, or the empty shape. */
export async function sportProfileFor(personId: string, sport: string): Promise<SportProfile> {
  const [row] = await dbHandle.db
    .select()
    .from(playerSportProfiles)
    .where(and(eq(playerSportProfiles.personId, personId), eq(playerSportProfiles.sport, sport)))
    .limit(1);
  if (row === undefined) {
    return emptySportProfile(sport);
  }
  return {
    sport: row.sport,
    defaultRole: row.defaultRole,
    attributes: (row.attributes ?? {}) as Record<string, string>,
  };
}

/** Every sport this person has said anything about. */
export async function sportProfilesFor(personId: string): Promise<SportProfile[]> {
  const rows = await dbHandle.db
    .select()
    .from(playerSportProfiles)
    .where(eq(playerSportProfiles.personId, personId))
    .orderBy(asc(playerSportProfiles.sport));
  return rows.map((row) => ({
    sport: row.sport,
    defaultRole: row.defaultRole,
    attributes: (row.attributes ?? {}) as Record<string, string>,
  }));
}

/**
 * THE SPORTS THIS PERSON ACTUALLY PLAYS.
 *
 * /account used to render a profile form for every sport the PLATFORM runs.
 * That was four panels and defensible; at eight it is a wall of forms for a
 * cricketer, seven of which ask how they bowl in a game they have never
 * entered. It gets worse with every pack, which is the wrong direction for a
 * screen to move as the product succeeds.
 *
 * Two sources, because both are real answers to "do you play this?":
 *   · a profile they have already filled in for that sport, and
 *   · a season they have registered in — the stronger signal of the two, and
 *     the one that arrives without them visiting this page at all.
 *
 * Withdrawn registrations count. Somebody who entered a hockey season and
 * pulled out still plays hockey, and hiding the panel would delete the answers
 * they gave.
 */
export async function sportsPlayedBy(personId: string): Promise<Set<string>> {
  const [profiles, entered] = await Promise.all([
    dbHandle.db
      .select({ sport: playerSportProfiles.sport })
      .from(playerSportProfiles)
      .where(eq(playerSportProfiles.personId, personId)),
    dbHandle.db
      .selectDistinct({ sport: competitions.sport })
      .from(registrations)
      .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
      .where(eq(registrations.personId, personId)),
  ]);
  return new Set([...profiles, ...entered].map((row) => row.sport));
}

/**
 * Write how a person plays ONE sport. Same contract as the person-level write:
 * the caller has validated against that sport's pack, this persists what it is
 * handed, and the audit row names the fields that CHANGED, never their values.
 */
export async function upsertSportProfile(personId: string, next: SportProfile): Promise<void> {
  const previous = await sportProfileFor(personId, next.sport);
  const changed: string[] = [];
  if (previous.defaultRole !== next.defaultRole) {
    changed.push("default_role");
  }
  for (const key of new Set([
    ...Object.keys(previous.attributes),
    ...Object.keys(next.attributes),
  ])) {
    if (previous.attributes[key] !== next.attributes[key]) {
      changed.push(key);
    }
  }
  if (changed.length === 0) {
    return;
  }
  await withTenantDb(dbHandle, { personId }, (db) =>
    db
      .insert(playerSportProfiles)
      .values({
        personId,
        sport: next.sport,
        defaultRole: next.defaultRole,
        attributes: next.attributes,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [playerSportProfiles.personId, playerSportProfiles.sport],
        set: { defaultRole: next.defaultRole, attributes: next.attributes, updatedAt: new Date() },
      }),
  );
  await logSecurityEvent(personId, "profile.player.updated", {
    fields: `${next.sport}:${changed.join(",")}`,
  });
}

/**
 * Write the whole profile document. Callers validate first (core validators);
 * this persists exactly what it is handed. The row is created lazily on first
 * write; a second write updates in place (one profile per person, by unique
 * index). The audit row names the fields that CHANGED, never their values.
 */
export async function upsertPlayerProfile(personId: string, next: PlayerProfile): Promise<void> {
  const previous = await playerProfileFor(personId);
  const changed = (Object.keys(next) as (keyof PlayerProfile)[]).filter(
    (key) => previous[key] !== next[key],
  );
  if (changed.length === 0) {
    return;
  }
  await withTenantDb(dbHandle, { personId }, (db) =>
    db
      .insert(playerProfiles)
      .values({ id: newId(), personId, ...next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: playerProfiles.personId,
        set: { ...next, updatedAt: new Date() },
      }),
  );
  await logSecurityEvent(personId, "profile.player.updated", {
    fields: changed.join(","),
  });
}

/**
 * The checklist, assembled from the rows the account page already stands on:
 * identity facts from `people`, defaults from the profile, and the caller's
 * passkey count (it has that read in hand — no second query here).
 */
export async function profileCompletenessFor(
  personId: string,
  passkeyCount?: number,
): Promise<ProfileCompleteness> {
  // Callers that already hold the passkey list pass its length; /home does not,
  // so the count is one indexed read here.
  const knownPasskeys =
    passkeyCount ??
    (
      await dbHandle.db
        .select({ id: passkeyCredentials.id })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.personId, personId))
    ).length;
  const [person] = await dbHandle.db
    .select({
      name: people.name,
      photoUrl: people.photoUrl,
      emailVerifiedAt: people.emailVerifiedAt,
    })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  const profile = await playerProfileFor(personId);
  /*
   * "Have you said how you play?" is now a question about ANY sport (Phase 3).
   * A person who has filled in their football profile and nothing else has
   * answered it — asking them for a cricket role to complete their account
   * would be asking about a sport they do not play.
   */
  const sports = await sportProfilesFor(personId);
  const anyRole = sports.find((entry) => entry.defaultRole !== null)?.defaultRole ?? null;
  const anyAttribute = (key: string): string | null =>
    sports.map((entry) => entry.attributes[key]).find((value) => value !== undefined) ?? null;
  return profileCompleteness({
    name: person?.name ?? null,
    photoUrl: person?.photoUrl ?? null,
    emailVerified: person?.emailVerifiedAt != null,
    dateOfBirth: profile.dateOfBirth,
    location: profile.location,
    defaultRole: anyRole,
    defaultBattingStyle: anyAttribute("batting_style"),
    defaultBowlingStyle: anyAttribute("bowling_style"),
    passkeyCount: knownPasskeys,
  });
}

/** Whether a profile row exists at all — the /home nudge's "is this a player?" half. */
export async function hasPlayerProfile(personId: string): Promise<boolean> {
  const [row] = await dbHandle.db
    .select({ id: playerProfiles.id })
    .from(playerProfiles)
    .where(eq(playerProfiles.personId, personId))
    .limit(1);
  return row !== undefined;
}
