"use server";
import { competitions, auditLog, newId, withTenantDb } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { resolveMemberCompetition } from "./resolve";
import { requireCompetitionCapability } from "./authz";
import { can } from "../entitlements";
import { sponsorDetails } from "../scoring/sponsor";

export async function saveSeasonSponsor(slug: string, name: string, useSeasonLogo: boolean) {
  const session = await currentSession();
  if (!session) return { ok: false, error: "Not available." };
  const competition = await resolveMemberCompetition(session.personId, slug);
  if (!competition) return { ok: false, error: "Not available." };
  if (
    typeof name !== "string" ||
    name.length > 120 ||
    Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    typeof useSeasonLogo !== "boolean"
  )
    return { ok: false, error: "Use a sponsor name up to 120 characters." };
  return withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    async (db) => {
      await requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "competition.manage",
      );
      const [current] = await db
        .select()
        .from(competitions)
        .where(eq(competitions.id, competition.id))
        .for("update");
      if (!current || !can(current, "overlay_sponsor"))
        return { ok: false, error: "Not available." };
      const sponsor = name.trim()
        ? { name: name.trim(), logoKey: useSeasonLogo ? (current.logoUrl ?? "") : "" }
        : null;
      const rules =
        current.scoringRules && typeof current.scoringRules === "object"
          ? current.scoringRules
          : {};
      await db
        .update(competitions)
        .set({ scoringRules: { ...rules, sponsor } })
        .where(eq(competitions.id, competition.id));
      await db.insert(auditLog).values({
        id: newId(),
        actor: session.personId,
        action: "competition.sponsor_changed",
        scopeType: "org",
        scopeId: competition.orgId,
        subject: competition.id,
        meta: { sponsor },
      });
      return { ok: true };
    },
  );
}
export async function seasonSponsorSettings(slug: string) {
  const session = await currentSession();
  if (!session) return null;
  const competition = await resolveMemberCompetition(session.personId, slug);
  if (!competition) return null;
  return withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    async (db) => {
      await requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "competition.manage",
      );
      const [row] = await db.select().from(competitions).where(eq(competitions.id, competition.id));
      if (!row) return null;
      const sponsor = sponsorDetails(row.scoringRules, competition.orgId, competition.id);
      return {
        name: sponsor?.name ?? "",
        usesLogo: Boolean(sponsor?.logoUrl),
        hasLogo: Boolean(row.logoUrl),
      };
    },
  );
}
