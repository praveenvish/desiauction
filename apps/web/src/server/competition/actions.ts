"use server";

import { isRejectionReason, type RegistrationEvent } from "@desiauction/core";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { db } from "../db";
import { ForbiddenError } from "../orgs/authz";
import { orgsFor } from "../orgs/orgs";
import { canCompetition, requireCompetitionCapability } from "./authz";
import {
  advanceCompetition,
  competitionForRegistration,
  competitionsForPerson,
  createCompetition,
  createTeam,
  resolveCompetition,
  teamsOf,
  type CompetitionSummary,
  type TeamSummary,
} from "./competitions";
import {
  myRegistration,
  registrationsOf,
  submitRegistration,
  triageRegistration,
  type RegistrationRow,
} from "./registrations";

// Org-scoped internal RPC (C-14, IP-3_DESIGN D1). Every action resolves the
// session, then the tenant, then the capability, then acts — no other path.

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export interface CompetitionsView {
  orgs: { id: string; name: string }[];
  competitions: (CompetitionSummary & { orgName: string })[];
}

export async function competitionsView(): Promise<CompetitionsView> {
  const session = await requireSession();
  const [orgs, competitions] = await Promise.all([
    orgsFor(db, session.personId),
    competitionsForPerson(db, session.personId),
  ]);
  return { orgs: orgs.map((o) => ({ id: o.id, name: o.name })), competitions };
}

export async function createCompetitionAction(
  _previous: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await requireSession();
  const orgId = formString(formData, "orgId");
  const name = formString(formData, "name");
  const location = formString(formData, "location");
  const startsOn = formString(formData, "startsOn");
  const endsOn = formString(formData, "endsOn");
  // Membership + capability: only an owner/staff of THIS org may create in it.
  const memberships = await orgsFor(db, session.personId);
  if (!memberships.some((o) => o.id === orgId)) {
    return { error: "Choose one of your organizations." };
  }
  let slug: string;
  try {
    await requireCompetitionCapability(db, session.personId, { orgId }, "competition.create");
    const competition = await createCompetition(db, orgId, session.personId, {
      name,
      location,
      startsOn,
      endsOn,
    });
    slug = competition.slug;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You can't create competitions in this organization." };
    }
    return { error: "Give the competition a name of at least 3 characters." };
  }
  redirect(`/competitions/${slug}`);
}

export interface CompetitionView {
  competition: CompetitionSummary;
  teams: TeamSummary[];
  registrations: RegistrationRow[];
  viewer: { canManage: boolean; canReview: boolean };
}

export async function competitionView(slug: string): Promise<CompetitionView | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const [teams, registrations, canManage, canReview] = await Promise.all([
    teamsOf(db, competition.id),
    registrationsOf(db, competition.id),
    canCompetition(db, session.personId, scope, "competition.manage"),
    canCompetition(db, session.personId, scope, "registration.review"),
  ]);
  return { competition, teams, registrations, viewer: { canManage, canReview } };
}

export async function advanceCompetitionAction(
  slug: string,
  to: CompetitionSummary["status"],
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await requireCompetitionCapability(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "competition.manage",
    );
  } catch {
    return { ok: false, error: "You can't manage this competition." };
  }
  const result = await advanceCompetition(db, competition, session.personId, to);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "guard_failed"
          ? "Set a name, dates and location before opening registration."
          : "That step isn't available yet.",
    };
  }
  return { ok: true };
}

export async function createTeamAction(
  slug: string,
  name: string,
  shortName: string,
  primaryColor: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await requireCompetitionCapability(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "team.manage",
    );
  } catch {
    return { ok: false, error: "You can't manage teams here." };
  }
  const result = await createTeam(
    db,
    competition.orgId,
    competition.id,
    session.personId,
    name,
    shortName,
    primaryColor,
  );
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "duplicate_name"
          ? "A team with that name already exists in this competition."
          : "Give the team a name of at least 3 characters.",
    };
  }
  return { ok: true };
}

export async function triageRegistrationAction(
  slug: string,
  registrationId: string,
  action: "approve" | "reject" | "waitlist",
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    // Approval's human gate (invariant 5): only a registration.review holder here.
    await requireCompetitionCapability(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "registration.review",
    );
  } catch {
    return { ok: false, error: "You can't review registrations here." };
  }
  let event: RegistrationEvent;
  if (action === "reject") {
    if (reason === undefined || !isRejectionReason(reason)) {
      return { ok: false, error: "Choose a reason to reject." };
    }
    event = { type: "reject", reason };
  } else {
    event = { type: action };
  }
  const result = await triageRegistration(
    db,
    competition.orgId,
    competition.id,
    registrationId,
    session.personId,
    event,
  );
  if (!result.ok) {
    return { ok: false, error: "That action isn't available for this registration." };
  }
  return { ok: true };
}

// --- Player-facing registration (any authenticated person) -------------------

export interface RegistrationLanding {
  competitionName: string;
  open: boolean;
  mine: { status: string; role: string } | null;
}

export async function registrationLanding(slug: string): Promise<RegistrationLanding | null> {
  const session = await requireSession();
  const competition = await competitionForRegistration(db, slug);
  if (competition === null) {
    return null;
  }
  const mine = await myRegistration(db, competition.id, session.personId);
  return {
    competitionName: competition.name,
    open: competition.status === "registration_open",
    mine,
  };
}

export async function submitRegistrationAction(
  slug: string,
  _previous: { error?: string; done?: boolean },
  formData: FormData,
): Promise<{ error?: string; done?: boolean }> {
  const session = await requireSession();
  const competition = await competitionForRegistration(db, slug);
  if (competition === null) {
    return { error: "This competition is not available." };
  }
  const role = formString(formData, "role");
  const result = await submitRegistration(
    db,
    competition.id,
    competition.orgId,
    session.personId,
    role,
  );
  if (!result.ok) {
    return {
      error:
        result.reason === "not_open"
          ? "Registration for this competition is not open."
          : result.reason === "duplicate"
            ? "You've already registered for this competition — check your status."
            : "Choose a valid playing role.",
    };
  }
  return { done: true };
}
