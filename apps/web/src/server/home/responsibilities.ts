import { memberCompetitions } from "../competition/resolve";
import { homeLineupTasks } from "./lineup-tasks";
import { operatorDoorHref } from "../../components/shell/nav";
import { rankHomeTasks, type HomeTask } from "../../lib/home-tasks";
import { platformDoorCapabilities } from "../admin/actions";
import { listInboxEvents } from "../auth/security-events";
import { finopsOrgIds } from "../financial-operations/actions";
import { myDocuments } from "../financial-operations/my-documents";
import { orgsOfPerson } from "../request-cache";
import type { PersonRoles } from "../roles/roles";
import { scoringResponsibilitiesForPerson } from "../scoring/home";
import { reminderId } from "../scoring/reminder-link";
import { confirmationHomeTask } from "../scoring/confirmation-home";
import { settlementOrgIds, settlementDashboard } from "../settlement/actions";

export interface HomeResponsibilities {
  tasks: HomeTask[];
  scorer: boolean;
  manager: boolean;
  finance: boolean;
  operator: boolean;
  hasDocuments: boolean;
}

/** Each reader retains its own current person/capability/tenant gate. No Home grant. */
export async function homeResponsibilities(
  personId: string,
  roles: PersonRoles,
): Promise<HomeResponsibilities> {
  const [scoring, financeIds, settleIds, platform, orgs, documents, notices] = await Promise.all([
    scoringResponsibilitiesForPerson(personId),
    finopsOrgIds(),
    settlementOrgIds(),
    platformDoorCapabilities(),
    orgsOfPerson(personId),
    myDocuments(personId),
    listInboxEvents(personId, 50),
  ]);
  const managedOrgs = new Set(roles.organizes.map((org) => org.orgId));
  const managedSeasons = managedOrgs.size
    ? (await memberCompetitions(personId)).filter((season) => managedOrgs.has(season.orgId))
    : [];
  const tasks: HomeTask[] = await homeLineupTasks(personId, [
    ...roles.owns.map((team) => team.competitionSlug),
    ...managedSeasons.map((season) => season.slug),
  ]);
  for (const season of roles.conducts) {
    if (!["live", "paused"].includes(season.auctionStatus ?? "")) continue;
    tasks.push({
      id: `conduct:${season.competitionSlug}`,
      kind: "conduct",
      scope: {
        ...(season.orgId ? { orgId: season.orgId } : {}),
        competitionId: season.competitionId,
      },
      priority: "conduct-live",
      dueAt: null,
      state: season.auctionStatus ?? "",
      title: "Run your live auction",
      context: season.competitionName,
      explanation:
        "The accepted auction state is live or paused. Your cockpit keeps the room moving.",
      action: "Open the cockpit",
      href: `/seasons/${season.competitionSlug}/auction/cockpit`,
      completion: "Engine accepts the terminal auction lifecycle.",
      retention: "server",
    });
  }
  for (const team of roles.owns) {
    if (!["live", "paused"].includes(team.auctionStatus)) continue;
    tasks.push({
      id: `owner:${team.competitionSlug}:${team.teamId}`,
      kind: "owner",
      scope: {
        ...(team.orgId ? { orgId: team.orgId } : {}),
        ...(team.competitionId ? { competitionId: team.competitionId } : {}),
        teamId: team.teamId,
      },
      priority: "owner-live",
      dueAt: null,
      state: team.auctionStatus,
      title: `Enter ${team.teamName}'s auction room`,
      context: team.competitionName,
      explanation:
        "Your team's auction is live or paused. All bids and purse checks still run in the room.",
      action: "Enter auction room",
      href: `/seasons/${team.competitionSlug}/auction/live`,
      completion: "Canonical auction status reaches its terminal state.",
      retention: "server",
    });
  }
  for (const { setup, orgId, competitionId, heldByCaller } of scoring) {
    const active = setup.phase !== null && setup.phase !== "not_started";
    const held = active && heldByCaller;
    tasks.push({
      id: `score:${setup.competitionSlug}:${setup.fixtureId}`,
      kind: "score",
      scope: { orgId, competitionId, fixtureId: setup.fixtureId },
      priority: held ? "score-held" : "today",
      dueAt: setup.kickoffAt,
      state: setup.phase ?? "not_started",
      title: `${held ? "Resume" : active ? "Open" : "Set up"} ${setup.fixtureNumber}`,
      context: `${setup.teams.map((team) => team.name).join(" vs ")} · ${setup.groundName}`,
      explanation: held
        ? "You're the current scorer. Open the match to check this device and any entries waiting to sync."
        : active
          ? "This match is in progress. Open it to see who is scoring and whether you can take over."
          : "This published match is on today's scoring list. Complete its required setup before recording play.",
      action: held ? "Resume scoring" : active ? "Open match" : "Complete match setup",
      href: `/score/${setup.fixtureId}`,
      completion:
        "Canonical accepted replay reaches the terminal match state; queued finish remains pending.",
      retention: "scoring-queue",
    });
  }
  // A current review destination does not mean this team still owes a response.
  const seenNotices = new Set<string>();
  const seenRevisions = new Set<string>();
  for (const notice of notices) {
    if (
      !["match.confirm_requested", "match.confirm_notice_dispatched"].includes(notice.action) ||
      typeof notice.meta !== "object" ||
      notice.meta === null ||
      !("noticeId" in notice.meta)
    )
      continue;
    const id = reminderId(notice.meta.noticeId);
    if (!id || seenNotices.has(id)) continue;
    seenNotices.add(id);
    const result = await confirmationHomeTask(personId, id);
    if (!result || seenRevisions.has(result.key)) continue;
    seenRevisions.add(result.key);
    const ready = result.state === "ready";
    tasks.push({
      id: `confirm:${result.key}`,
      kind: "confirm",
      scope: result.scope,
      priority: ready ? "today" : result.state === "waiting" ? "waiting" : "result",
      dueAt: null,
      state: result.state,
      title: ready
        ? `Review result for ${result.team}`
        : result.state === "waiting"
          ? "Response recorded · result under review"
          : result.state === "resolved"
            ? "Result reviewed"
            : "Team response recorded",
      context: result.context,
      explanation: ready
        ? "Review the current result before responding for your team. A correction can require a fresh response."
        : result.state === "waiting"
          ? "Your team has responded. An unresolved review remains; you do not need to repeat that response."
          : result.state === "resolved"
            ? "An authorised review has resolved this revision. You can still inspect the result."
            : "An eligible manager's response is recorded for your team and this revision. You can still review it.",
      action: "Review the result",
      href: result.href,
      completion: "A linked team response or authorised resolution exists for this exact revision.",
      retention: "server",
    });
  }
  const finances = new Set(financeIds),
    settlements = new Set(settleIds);
  for (const org of orgs) {
    if (settlements.has(org.id)) {
      const desk = await settlementDashboard(org.slug);
      if (desk) {
        for (const row of desk.view.cases) {
          if (!row.needsAttention) continue;
          const actionable =
            desk.viewer.canManage ||
            (desk.viewer.canCollect && row.status === "settling" && row.outstanding > 0);
          tasks.push({
            id: `finance:${org.id}:${row.caseId}`,
            kind: "finance",
            scope: { orgId: org.id, competitionId: row.competitionId, caseId: row.caseId },
            priority: actionable ? "today" : "waiting",
            dueAt: null,
            state: row.status,
            title: `${actionable ? "Review" : "View"} ${row.competitionName}'s settlement`,
            context: org.name,
            explanation: actionable
              ? "This recorded settlement case needs attention. Open it to see the actions available to you."
              : "This case needs an authorised officer or collector. You can inspect the permitted case status.",
            action: "Open settlement case",
            href: `/seasons/${row.competitionSlug}/money/case/${row.caseId}`,
            completion: "Accepted audited case state resolves its current exception.",
            retention: "server",
          });
        }
        tasks.push({
          id: `settlement-desk:${org.id}`,
          kind: "finance",
          scope: { orgId: org.id },
          priority: "waiting",
          dueAt: null,
          state: "permitted_desk",
          title: "Your settlement desk",
          context: org.name,
          explanation:
            "Open the current cases and their accepted status. No due date is inferred from an invoice.",
          action: "Open settlement desk",
          href: `/org/${org.slug}/settlement`,
          completion: "Read-only entry; individual case actions determine completion.",
          retention: "read-only",
        });
      }
    }
    if (finances.has(org.id))
      tasks.push({
        id: `finance-desk:${org.id}`,
        kind: "finance",
        scope: { orgId: org.id },
        priority: "waiting",
        dueAt: null,
        state: "permitted_desk",
        title: "Your finance desk",
        context: org.name,
        explanation:
          "Documents, deliveries and reconciliation keep their separate current permissions.",
        action: "Open finance desk",
        href: `/org/${org.slug}/money`,
        completion:
          "Read-only entry; accepted document or reconciliation state determines completion.",
        retention: "read-only",
      });
  }
  const operatorHref = operatorDoorHref(platform);
  if (operatorHref)
    tasks.push({
      id: `operator:${operatorHref}`,
      kind: "operator",
      scope: {},
      priority: "waiting",
      dueAt: null,
      state: "permitted_desk",
      title: "Your platform workspace",
      context: "Assigned platform capabilities",
      explanation:
        "Open the workspace assigned to you. Your other platform duties remain available in its navigation.",
      action: "Open platform workspace",
      href: operatorHref,
      completion: "Observation is not a completed repair; desk actions recheck authority.",
      retention: "read-only",
    });
  for (const document of documents) {
    if (tasks.some((task) => task.kind === "receipt" && task.scope.teamId === document.teamId))
      continue;
    tasks.push({
      id: `documents:${document.teamId}`,
      kind: "receipt",
      scope: { teamId: document.teamId },
      priority: "result",
      dueAt: null,
      state: "sealed_documents",
      title: `${document.teamName}'s issued documents`,
      context: document.orgName ?? "My documents",
      explanation:
        "These are sealed documents issued to your team. An invoice alone is not proof of payment.",
      action: "View my documents",
      href: "/money",
      completion: "Sealed issued document exists.",
      retention: "read-only",
    });
  }
  return {
    tasks: rankHomeTasks(tasks),
    scorer: roles.scores.some((season) => season.scorer === true),
    manager: roles.scores.some((season) => (season.managerTeamIds?.length ?? 0) > 0),
    finance: financeIds.length > 0 || settleIds.length > 0,
    operator: operatorHref !== null,
    hasDocuments: documents.length > 0,
  };
}
