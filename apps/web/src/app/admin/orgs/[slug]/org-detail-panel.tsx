import {
  EmptyState,
  IconArrowRight,
  IconClock,
  IconExternal,
  IconTrophy,
  IconUsers,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
} from "@desiauction/ui";
import Link from "next/link";

import { PageTitle } from "../../../../components/shell/page-title";
import { formatDateRange } from "../../../../lib/format-date";
import { PLATFORM_SCOPE_ID } from "../../../../server/admin/capabilities";
import { formatCount, lifecycleLabel, maskPersonContact } from "../../../../server/admin/format";
import type { OrgCompetitionRow, OrgDetail } from "../../../../server/admin/views";
import type { ClubDesk } from "../../../../server/platform-ops/club";
import type { MoveDesk, MoveSubject } from "../../../../server/platform-ops/move-tournament";
import {
  absoluteIst,
  AdminPageHead,
  capabilityLabel,
  foldRuns,
  humanAction,
  KpiValue,
  monogram,
  RelativeTime,
  statusPillTone,
} from "../../admin-ui";
import { DeskAction } from "./org-desk";

/**
 * PX-9 §2 — THE CLUB, AS AN ADMIN NEEDS TO SEE IT.
 *
 * Founder review (2026-10-06, "3.5/10, not understanding at all"): the page
 * answered every question in its own card and several of them twice. The one
 * club owner appeared in Grants, again in Members and again in the roles
 * desk; every season appeared in the Seasons table, again in the roles desk
 * and again (with its tournament) in "Move to another club"; four big tiles
 * said 2, 1, 1 and "None"; and a Members card stretched a screen tall beside
 * the activity feed.
 *
 * An admin opens a club to answer three things, in this order — what is it
 * running, who can act for it, and what happened lately — and to fix
 * something on the spot. So: the tournaments with their seasons, each season
 * carrying its own numbers and its own controls; one row per person with
 * every role they hold and the buttons for those roles; and the activity.
 * Each thing is listed once, and its buttons sit on it.
 *
 * The superadmin's controls (`DeskAction`) render only inside `OrgDesk`, which
 * the page mounts for `platform.grant` holders; a read-only admin sees the
 * same page without them.
 */
export function OrgDetailPanel({
  detail,
  desk,
  move,
}: {
  detail: OrgDetail;
  desk: ClubDesk | null;
  move: MoveDesk | null;
}) {
  const { org, competitions, members, grants, finance, activity } = detail;
  const people = peopleOf(detail, desk);
  const owners = people.filter((person) => person.owner);
  const withAccess = people.filter((person) => person.roles.length > 0).length;
  const pastGrants = grants.filter((grant) => grant.revokedAt !== null);
  const groups = tournamentsOf(competitions);
  const tournamentCount = groups.filter((group) => group.id !== null).length;

  const teams = competitions.reduce((sum, row) => sum + row.teamCount, 0);
  const players = competitions.reduce((sum, row) => sum + row.playerCount, 0);
  const pending = competitions.reduce((sum, row) => sum + row.pendingCount, 0);
  const openCount = competitions.filter((row) => row.status === "registration_open").length;
  const liveCount = competitions.filter(
    (row) => row.auctionStatus === "live" || row.auctionStatus === "paused",
  ).length;

  const subjectOf = (kind: MoveSubject["kind"], id: string): MoveSubject | null =>
    move?.subjects.find((subject) => subject.kind === kind && subject.id === id) ?? null;

  return (
    <>
      <PageTitle title={org.name} />
      <AdminPageHead
        readOnly={desk === null}
        actions={
          <>
            {/* Opens only for someone who also holds org capability HERE —
                `platform:admin` confers none. Named in its tooltip rather than
                discovered as a 404 behind it. */}
            <Link
              href={`/org/${org.slug}`}
              className="admin-head-button"
              data-testid="admin-open-org"
              title="Needs organizer permissions on this organization; a platform grant confers none."
            >
              Open console
              <IconExternal size={16} />
            </Link>
            <Link href="/admin/orgs" className="admin-head-button">
              All organizations
            </Link>
          </>
        }
      >
        <span className="og-lede">
          <span className="admin-id admin-chip-id">{org.slug}</span>
          <span>
            Owner{" "}
            {owners.length === 0 ? (
              <b className="og-warn">none</b>
            ) : (
              owners.map((owner, index) => (
                <span key={owner.personId}>
                  {index > 0 ? ", " : ""}
                  <Link href={`/admin/people/${owner.personId}`} className="og-link">
                    {owner.label}
                  </Link>
                </span>
              ))
            )}
          </span>
          <span>Created {absoluteIst(org.createdAt).replace(/,.*$/, "")}</span>
          <span>
            Finance profile{" "}
            {finance.declared ? (
              <b>
                declared
                {finance.posture === null || finance.posture === "none"
                  ? ""
                  : ` · ${finance.posture}`}
              </b>
            ) : (
              <span className="og-quiet">not declared</span>
            )}
          </span>
        </span>
      </AdminPageHead>

      <StatGrid>
        <StatCard
          icon={<IconTrophy />}
          concept="season"
          value={<KpiValue n={competitions.length} />}
          label={competitions.length === 1 ? "Season" : "Seasons"}
          {...(liveCount > 0
            ? { hint: `${String(liveCount)} auction live now` }
            : openCount > 0
              ? { hint: `${String(openCount)} open for registration` }
              : tournamentCount > 0
                ? {
                    hint: `in ${formatCount(tournamentCount)} tournament${tournamentCount === 1 ? "" : "s"}`,
                  }
                : {})}
        />
        <StatCard
          icon={<IconTrophy />}
          concept="neutral"
          value={<KpiValue n={teams} />}
          label={teams === 1 ? "Team" : "Teams"}
        />
        <StatCard
          icon={<IconUsers />}
          concept="neutral"
          value={<KpiValue n={players} />}
          label="Approved players"
          {...(pending > 0 ? { hint: `${formatCount(pending)} waiting for review` } : {})}
        />
        <StatCard
          icon={<IconUsers />}
          concept="neutral"
          value={<KpiValue n={withAccess} />}
          label={withAccess === 1 ? "Person with access" : "People with access"}
          {...(members.length > withAccess
            ? { hint: `${formatCount(members.length - withAccess)} more members` }
            : {})}
        />
      </StatGrid>

      <div className="og-layout">
        <SectionCard
          icon={<IconTrophy />}
          concept="season"
          title="Tournaments"
          description={
            competitions.length === 0
              ? "Nothing created yet."
              : `${formatCount(competitions.length)} season${competitions.length === 1 ? "" : "s"}, grouped by tournament.`
          }
          flush
        >
          {competitions.length === 0 ? (
            <div className="admin-card-empty">
              <EmptyState
                size="compact"
                headingLevel={3}
                title="No seasons"
                description="This club has not created a tournament yet."
              />
            </div>
          ) : (
            <div className="og-tournaments" data-testid="admin-org-competitions">
              {groups.map((group) => {
                const tournamentSubject =
                  group.id === null ? null : subjectOf("tournament", group.id);
                return (
                  <section key={group.id ?? "one-off"} className="og-tournament">
                    <header className="og-tournament-head">
                      <h3>{group.name}</h3>
                      <span className="og-quiet">
                        {group.id === null
                          ? "Seasons without a tournament"
                          : `${String(group.seasons.length)} season${group.seasons.length === 1 ? "" : "s"}`}
                      </span>
                      {tournamentSubject === null ? null : (
                        <MoveControl subject={tournamentSubject} label="Move tournament…" />
                      )}
                    </header>
                    <ul className="og-seasons">
                      {group.seasons.map((season) => (
                        <SeasonBlock
                          key={season.id}
                          season={season}
                          desk={desk?.seasons.find((row) => row.id === season.id) ?? null}
                          moveSubject={subjectOf("season", season.id)}
                          hideMove={group.seasons.length === 1 && tournamentSubject !== null}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={<IconClock />}
          tone="neutral"
          title="Recent activity"
          flush
          {...(activity.length > 0
            ? {
                action: (
                  <Link href={`/admin/audit?scopeId=${org.id}`} className="admin-card-link">
                    Full history
                    <IconArrowRight size={16} className="icon-trail" />
                  </Link>
                ),
              }
            : {})}
        >
          {activity.length === 0 ? (
            <div className="admin-card-empty">
              <EmptyState
                size="compact"
                headingLevel={3}
                title="Nothing yet"
                description="No recorded action on this club."
              />
            </div>
          ) : (
            <ul className="og-activity">
              {/* The latest few beside the tournaments; the rest is "Full history". */}
              {foldRuns(activity, (a, b) => a.action === b.action && a.actor === b.actor)
                .slice(0, 6)
                .map(({ row, count }) => (
                  <li key={row.id}>
                    <span className="og-activity-what" title={row.action}>
                      {humanAction(row.action)}
                      {count > 1 ? <span className="admin-times"> ×{count}</span> : null}
                    </span>
                    <span className="og-activity-meta">
                      {row.actorName ??
                        (row.actor === PLATFORM_SCOPE_ID
                          ? "DesiAuction (automatic)"
                          : row.actor.slice(-6))}{" "}
                      · <RelativeTime at={row.at} />
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        icon={<IconUsers />}
        tone="purple"
        title="People & access"
        description="Who can act for this club, and every role they hold."
        flush
        action={
          <DeskAction act={{ kind: "add" }} variant="secondary" testId="desk-add">
            Add owner or staff
          </DeskAction>
        }
      >
        {people.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title="Nobody yet"
              description="No member and no role on this club."
            />
          </div>
        ) : (
          <ul className="og-people" data-testid="admin-org-grants">
            {people.map((person) => (
              <li key={person.personId} className="og-person">
                <span className="og-avatar" aria-hidden>
                  {monogram(person.name)}
                </span>
                <span className="og-person-main">
                  <Link
                    href={`/admin/people/${person.personId}`}
                    className="admin-name"
                    {...(person.name === null ? { "data-private": "" } : {})}
                  >
                    {person.label}
                  </Link>
                  <span className="og-roles">
                    {person.roles.length === 0 ? (
                      <Pill tone="neutral">Member</Pill>
                    ) : (
                      person.roles.map((role) => (
                        <span key={role.key} title={role.set}>
                          <Pill tone={role.tone}>{role.label}</Pill>
                        </span>
                      ))
                    )}
                  </span>
                  <span className="og-person-meta">
                    {person.contact === null ? null : <span data-private>{person.contact}</span>}
                    {person.joinedAt === null ? null : (
                      <span>
                        joined <RelativeTime at={person.joinedAt} />
                      </span>
                    )}
                  </span>
                </span>
                <span className="og-person-actions">
                  {person.owner ? (
                    <>
                      <DeskAction
                        act={{
                          kind: "transfer",
                          personId: person.personId,
                          name: person.label,
                        }}
                        testId="desk-transfer"
                      >
                        Transfer
                      </DeskAction>
                      <DeskAction
                        act={{
                          kind: "remove",
                          personId: person.personId,
                          name: person.label,
                          role: "org:owner",
                        }}
                      >
                        Remove
                      </DeskAction>
                    </>
                  ) : person.staff ? (
                    <DeskAction
                      act={{
                        kind: "remove",
                        personId: person.personId,
                        name: person.label,
                        role: "org:staff",
                      }}
                    >
                      Remove
                    </DeskAction>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {pastGrants.length === 0 ? null : (
          <details className="og-past">
            <summary>
              {formatCount(pastGrants.length)} past role{pastGrants.length === 1 ? "" : "s"}
            </summary>
            <ul>
              {pastGrants.map((grant) => (
                <li key={grant.id}>
                  <Link href={`/admin/people/${grant.personId}`} className="og-link">
                    {grant.name ?? grant.personId.slice(-6)}
                  </Link>{" "}
                  · {capabilityLabel(grant.capabilitySet)}
                  {grant.revokedAt === null ? null : (
                    <span className="og-quiet"> · ended {absoluteIst(grant.revokedAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </SectionCard>
    </>
  );
}

/* --- One season ------------------------------------------------------------ */

function SeasonBlock({
  season,
  desk,
  moveSubject,
  hideMove,
}: {
  season: OrgCompetitionRow;
  desk: ClubDesk["seasons"][number] | null;
  moveSubject: MoveSubject | null;
  /** A tournament with one season moves from its header; one button is enough. */
  hideMove: boolean;
}) {
  const stage = seasonStageOf(season);
  const dates =
    season.startsOn === null && season.endsOn === null
      ? null
      : formatDateRange(season.startsOn, season.endsOn);
  const hasAuction = season.auctionStatus !== null && season.auctionId !== null;
  const waiting = desk?.teams.filter((team) => !team.ownerJoined) ?? [];
  return (
    <li className="og-season">
      <div className="og-season-head">
        {/* /seasons/<slug> is a member's workspace and notFound()s for a
            platform admin who is not in the club. The doors that DO open: the
            public page when the season is public (and not taken down), else
            the admin auction watch when it has an auction, else the name. */}
        {season.visibility === "public" && !season.held ? (
          <Link href={`/c/${season.slug}`} className="og-season-name">
            {season.name}
          </Link>
        ) : season.auctionId !== null ? (
          <Link href={`/admin/auctions/${season.auctionId}`} className="og-season-name">
            {season.name}
          </Link>
        ) : (
          <span className="og-season-name">{season.name}</span>
        )}
        <span className="og-pills">
          <Pill tone={stage.tone} dot>
            {stage.label}
          </Pill>
          {season.held ? (
            <Pill tone="red">Taken down</Pill>
          ) : (
            <Pill tone={season.visibility === "public" ? "blue" : "neutral"}>
              {lifecycleLabel(season.visibility)}
            </Pill>
          )}
        </span>
        {hideMove || moveSubject === null ? null : (
          <MoveControl subject={moveSubject} label="Move…" />
        )}
      </div>

      <dl className="og-facts">
        <div>
          <dt>Dates</dt>
          <dd>{dates ?? <span className="og-quiet">Not set</span>}</dd>
        </div>
        <div>
          <dt>Teams</dt>
          <dd>{season.teamCount}</dd>
        </div>
        <div>
          <dt>Players</dt>
          <dd>
            {season.playerCount}
            {season.pendingCount > 0 ? (
              <span className="og-flag"> +{season.pendingCount} to review</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Auction</dt>
          <dd>
            {hasAuction ? (
              <Link
                href={`/admin/auctions/${season.auctionId}`}
                className="admin-badge-link"
                aria-label={`Watch this auction (${lifecycleLabel(season.auctionStatus)})`}
              >
                <Pill tone={statusPillTone(season.auctionStatus)} dot>
                  {lifecycleLabel(season.auctionStatus)}
                </Pill>
              </Link>
            ) : (
              <span className="og-quiet">Not set up</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Settlement</dt>
          <dd>
            {season.caseStatus === null ? (
              <span className="og-quiet">—</span>
            ) : (
              <Pill tone={statusPillTone(season.caseStatus)} dot>
                {lifecycleLabel(season.caseStatus)}
              </Pill>
            )}
          </dd>
        </div>
      </dl>

      {desk === null ? null : (
        <div className="og-season-desk">
          <div className="og-desk-line">
            <span className="og-desk-label">Auctioneer</span>
            <span className="og-desk-value">
              {desk.auctioneers.length === 0 ? (
                <span className="og-quiet">Not assigned</span>
              ) : (
                desk.auctioneers.map((row) => (
                  <span key={row.personId} className="og-desk-chip">
                    {row.name ?? "Unnamed"}
                    <DeskAction
                      act={{
                        kind: "unassign",
                        seasonId: season.id,
                        personId: row.personId,
                        name: row.name ?? "Unnamed",
                      }}
                    >
                      Remove
                    </DeskAction>
                  </span>
                ))
              )}
            </span>
            <DeskAction act={{ kind: "assign", seasonId: season.id, seasonName: season.name }}>
              {desk.auctioneers.length === 0 ? "Assign" : "Add"}
            </DeskAction>
          </div>
          <div className="og-desk-line">
            <span className="og-desk-label">Team owners</span>
            {desk.teams.length === 0 ? (
              <span className="og-quiet">No teams yet</span>
            ) : !hasAuction ? (
              // Owner links belong to an auction; the server refuses one
              // before it exists, so none is offered.
              <span className="og-quiet">Links open once the auction is created</span>
            ) : waiting.length === 0 ? (
              <span className="og-ok">All {desk.teams.length} joined</span>
            ) : (
              <details className="og-owners">
                <summary>
                  {desk.teams.length - waiting.length} of {desk.teams.length} joined ·{" "}
                  {waiting.length} waiting
                </summary>
                <ul>
                  {waiting.map((team) => (
                    <li key={team.id}>
                      <span>{team.name}</span>
                      <DeskAction
                        act={{
                          kind: "link",
                          seasonId: season.id,
                          teamId: team.id,
                          teamName: team.name,
                        }}
                      >
                        New owner link
                      </DeskAction>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function MoveControl({ subject, label }: { subject: MoveSubject; label: string }) {
  if (subject.blocked !== null) {
    return (
      <span className="og-quiet og-move-blocked" title={`Can't move: ${subject.blocked}`}>
        Can&apos;t move now
      </span>
    );
  }
  return (
    <span className="og-move">
      <DeskAction act={{ kind: "move", subject }} testId="move-open">
        {label}
      </DeskAction>
    </span>
  );
}

/* --- Shaping --------------------------------------------------------------- */

interface Group {
  id: string | null;
  name: string;
  seasons: OrgCompetitionRow[];
}

/** Seasons under their tournament, newest tournament first; one-offs last. */
function tournamentsOf(competitions: readonly OrgCompetitionRow[]): Group[] {
  const groups = new Map<string, Group>();
  for (const season of competitions) {
    const key = season.tournamentId ?? "";
    const group = groups.get(key) ?? {
      id: season.tournamentId,
      name: season.tournamentName ?? "One-off seasons",
      seasons: [],
    };
    group.seasons.push(season);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(a.id === null) - Number(b.id === null));
}

interface Role {
  key: string;
  label: string;
  set: string;
  tone: "gold" | "purple" | "blue" | "neutral";
}

interface Person {
  personId: string;
  name: string | null;
  label: string;
  contact: string | null;
  joinedAt: Date | null;
  roles: Role[];
  owner: boolean;
  staff: boolean;
}

const ROLE_RANK: Record<string, number> = { "org:owner": 0, "org:staff": 1 };

/**
 * ONE ROW PER PERSON. Members, the club's active grants and the season
 * auctioneers used to be three lists of the same people; here they are one,
 * each person carrying every role they hold. Owners first, then staff, then
 * other roles, then members with none.
 */
function peopleOf(detail: OrgDetail, desk: ClubDesk | null): Person[] {
  const byId = new Map<string, Person>();
  const ensure = (personId: string, name: string | null): Person => {
    const existing = byId.get(personId);
    if (existing !== undefined) {
      return existing;
    }
    const person: Person = {
      personId,
      name,
      label: name ?? personId.slice(-6),
      contact: null,
      joinedAt: null,
      roles: [],
      owner: false,
      staff: false,
    };
    byId.set(personId, person);
    return person;
  };
  for (const member of detail.members) {
    const person = ensure(member.personId, member.name);
    const contact = maskPersonContact(member);
    person.contact = contact;
    person.joinedAt = member.joinedAt;
    if (member.name === null) {
      person.label = contact;
    }
  }
  for (const grant of detail.grants) {
    if (grant.revokedAt !== null) {
      continue;
    }
    const person = ensure(grant.personId, grant.name);
    if (person.roles.some((role) => role.set === grant.capabilitySet)) {
      continue;
    }
    person.owner ||= grant.capabilitySet === "org:owner";
    person.staff ||= grant.capabilitySet === "org:staff";
    person.roles.push({
      key: grant.id,
      label: capabilityLabel(grant.capabilitySet),
      set: grant.capabilitySet,
      tone:
        grant.capabilitySet === "org:owner"
          ? "gold"
          : grant.capabilitySet === "org:staff"
            ? "blue"
            : "purple",
    });
  }
  for (const season of desk?.seasons ?? []) {
    for (const auctioneer of season.auctioneers) {
      const person = ensure(auctioneer.personId, auctioneer.name);
      person.roles.push({
        key: `auction-${season.id}`,
        label: `Auctioneer · ${season.name}`,
        set: "auction:conductor",
        tone: "neutral",
      });
    }
  }
  const rank = (person: Person) =>
    Math.min(99, ...person.roles.map((role) => ROLE_RANK[role.set] ?? 2)) +
    (person.roles.length === 0 ? 100 : 0);
  return [...byId.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/**
 * THE SEASON'S STAGE, in the console's words (census 2026-09-28). The later
 * facts (the books, the auction) are read first, as `seasonStage` does for
 * the console.
 */
function seasonStageOf(competition: {
  status: string;
  auctionStatus: string | null;
  caseStatus: string | null;
}): { label: string; tone: ReturnType<typeof statusPillTone> } {
  if (competition.caseStatus === "settled" || competition.caseStatus === "closed") {
    return { label: "Finished", tone: statusPillTone("closed") };
  }
  if (competition.auctionStatus === "completed" || competition.auctionStatus === "reconciled") {
    return { label: "Season on", tone: statusPillTone("completed") };
  }
  if (competition.auctionStatus === "live" || competition.auctionStatus === "paused") {
    return { label: "Auction live", tone: statusPillTone(competition.auctionStatus) };
  }
  return { label: lifecycleLabel(competition.status), tone: statusPillTone(competition.status) };
}
