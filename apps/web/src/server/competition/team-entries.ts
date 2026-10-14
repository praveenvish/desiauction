import { looksLikePlaceholderPhone, normalizePhone } from "@desiauction/core";
import { auditLog, competitions, newId, teamEntries, teamManagers, type Db } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireCompetitionCapability } from "./authz";
import { createTeam } from "./competitions";
import { assignTeam, transition } from "./registration-aggregate";
import { addPlayerByPhone } from "./registrations";
import { TEAM_ENTRY_CODE } from "./team-entry-code";

const playerInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().optional(),
  })
  .strict();
export const teamEntryInput = z
  .object({
    teamName: z.string().trim().min(3).max(120),
    players: z.array(playerInput).min(1).max(30),
  })
  .strict();
const unavailable = "This team sign-up link is unavailable. Ask the organizer for a current link.";

export async function submitTeamEntry(
  db: Db,
  scope: { orgId: string; competitionId: string },
  captainPersonId: string,
  code: string,
  raw: unknown,
) {
  const input = teamEntryInput.parse(raw);
  if (!TEAM_ENTRY_CODE.test(code)) throw new Error(unavailable);
  for (const player of input.players) {
    if (player.phone !== undefined && player.phone !== "") {
      const normalized = normalizePhone(player.phone);
      if (!normalized.ok || looksLikePlaceholderPhone(normalized.phone)) {
        throw new Error("Enter a valid mobile number or leave it empty.");
      }
      player.phone = normalized.phone;
    }
  }
  return db.transaction(async (tx) => {
    const [season] = await tx
      .select({ id: competitions.id })
      .from(competitions)
      .where(
        and(
          eq(competitions.id, scope.competitionId),
          eq(competitions.orgId, scope.orgId),
          eq(competitions.entryCode, code),
          eq(competitions.teamFormation, "team_entry"),
          eq(competitions.status, "registration_open"),
        ),
      )
      .for("update");
    if (season === undefined) throw new Error(unavailable);
    const id = newId();
    await tx.insert(teamEntries).values({
      id,
      orgId: scope.orgId,
      competitionId: scope.competitionId,
      captainPersonId,
      teamName: input.teamName,
      players: input.players.map((player) => ({
        name: player.name,
        ...(player.phone !== undefined ? { phone: player.phone } : {}),
      })),
      status: "submitted",
    });
    return id;
  });
}

export async function reviewTeamEntry(
  db: Db,
  scope: { orgId: string; competitionId: string },
  reviewerId: string,
  entryId: string,
  decision: "approve" | "reject",
  reason = "",
) {
  await requireCompetitionCapability(db, reviewerId, scope, "team.manage");
  await requireCompetitionCapability(db, reviewerId, scope, "registration.review");
  if (decision === "reject" && reason.trim() === "") throw new Error("Give a rejection reason.");
  return db.transaction(async (tx) => {
    const [season] = await tx
      .select({ id: competitions.id })
      .from(competitions)
      .where(
        and(
          eq(competitions.id, scope.competitionId),
          eq(competitions.orgId, scope.orgId),
          eq(competitions.teamFormation, "team_entry"),
        ),
      )
      .for("update");
    if (season === undefined) throw new Error("Team sign-up is unavailable.");
    const [entry] = await tx
      .select()
      .from(teamEntries)
      .where(
        and(
          eq(teamEntries.id, entryId),
          eq(teamEntries.orgId, scope.orgId),
          eq(teamEntries.competitionId, scope.competitionId),
        ),
      )
      .for("update");
    if (entry === undefined) throw new Error("Team entry unavailable.");
    if (entry.status !== "submitted") return { status: entry.status };
    let teamId: string | undefined;
    if (decision === "approve") {
      const made = await createTeam(
        tx,
        scope.orgId,
        scope.competitionId,
        reviewerId,
        entry.teamName,
      );
      if (!made.ok)
        throw new Error(made.reason === "tier_limit" ? made.message : "Choose a unique team name.");
      teamId = made.team.id;
      for (const player of teamEntryInput.parse({
        teamName: entry.teamName,
        players: entry.players,
      }).players) {
        const added = await addPlayerByPhone(tx, scope.competitionId, scope.orgId, reviewerId, {
          name: player.name,
          phone: player.phone || null,
          role: "",
          basePriceBand: null,
        });
        if (!added.ok)
          throw new Error("A player is already in this season. Review the entry before approving.");
        const approved = await transition(
          tx,
          scope.orgId,
          scope.competitionId,
          added.registrationId,
          reviewerId,
          { type: "approve" },
        );
        if (!approved.ok) throw new Error("This player could not be approved.");
        const assigned = await assignTeam(
          tx,
          scope.orgId,
          scope.competitionId,
          added.registrationId,
          teamId,
          reviewerId,
        );
        if (!assigned.ok) throw new Error("This player could not join the team.");
      }
      await tx.insert(teamManagers).values({
        id: newId(),
        orgId: scope.orgId,
        competitionId: scope.competitionId,
        teamId,
        personId: entry.captainPersonId,
        role: "captain",
        source: "team_entry",
        createdBy: reviewerId,
      });
    }
    const status = decision === "approve" ? "approved" : "rejected";
    await tx
      .update(teamEntries)
      .set({ status, reviewedBy: reviewerId, reviewedAt: new Date() })
      .where(eq(teamEntries.id, entry.id));
    await tx.insert(auditLog).values({
      id: newId(),
      actor: reviewerId,
      scopeType: "org",
      scopeId: scope.orgId,
      action: `team_entry.${status}`,
      subject: entry.id,
      meta: {
        ...(teamId !== undefined ? { teamId } : {}),
        ...(decision === "reject" ? { reason: reason.trim() } : {}),
      },
    });
    return { status };
  });
}
