import { newId, playerProfiles, withTenantDb } from "@desiauction/db";
import type { Gender, PlayerRole } from "@desiauction/core";
import { eq } from "drizzle-orm";

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
export interface PlayerProfile {
  gender: Gender | null;
  genderSelfDescribed: string | null;
  dateOfBirth: string | null;
  location: string | null;
  defaultRole: PlayerRole | null;
  defaultBattingStyle: string | null;
  defaultBowlingStyle: string | null;
  preferredJerseyName: string | null;
  preferredJerseyNumber: string | null;
}

export const EMPTY_PLAYER_PROFILE: PlayerProfile = {
  gender: null,
  genderSelfDescribed: null,
  dateOfBirth: null,
  location: null,
  defaultRole: null,
  defaultBattingStyle: null,
  defaultBowlingStyle: null,
  preferredJerseyName: null,
  preferredJerseyNumber: null,
};

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
    defaultRole: row.defaultRole,
    defaultBattingStyle: row.defaultBattingStyle,
    defaultBowlingStyle: row.defaultBowlingStyle,
    preferredJerseyName: row.preferredJerseyName,
    preferredJerseyNumber: row.preferredJerseyNumber,
  };
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

