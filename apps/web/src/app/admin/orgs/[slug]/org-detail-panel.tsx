import {
  CardGrid,
  EmptyState,
  IconArrowRight,
  IconClock,
  IconExternal,
  IconKey,
  IconLedger,
  IconTrophy,
  IconUsers,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
} from "@desiauction/ui";
import Link from "next/link";

import { PageTitle } from "../../../../components/shell/page-title";
import { formatCount, lifecycleLabel, maskPersonContact } from "../../../../server/admin/format";
import type { OrgDetail } from "../../../../server/admin/views";
import {
  absoluteIst,
  AdminPageHead,
  foldRuns,
  humanAction,
  KpiValue,
  RelativeTime,
  statusPillTone,
} from "../../admin-ui";

/**
 * PX-9 §2 — the organization inspector.
 *
 * The grants table is the governance answer to "who can do what here", and it
 * shows the capability SET verbatim (`org:owner`, `settlement:controller`,
 * `finops:accountant`) rather than a friendly word. That is deliberate: the
 * four capability engines partition the space, so a set name is the only
 * honest description of what someone actually holds. Rewriting them as "Admin"
 * would erase exactly the distinction the platform is built on.
 */
export function OrgDetailPanel({ detail }: { detail: OrgDetail }) {
  const { org, competitions, members, grants, finance, activity } = detail;
  const active = grants.filter((grant) => grant.revokedAt === null);
  return (
    <>
      <PageTitle title={org.name} />
      <AdminPageHead
        readOnly
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
        <span className="admin-id admin-chip-id">{org.slug}</span>
        <span className="admin-meta"> · created {absoluteIst(org.createdAt)}</span>
      </AdminPageHead>

      <StatGrid>
        <StatCard
          icon={<IconTrophy />}
          concept="season"
          value={<KpiValue n={competitions.length} />}
          label="Seasons"
        />
        <StatCard
          icon={<IconUsers />}
          concept="neutral"
          value={<KpiValue n={members.length} />}
          label="Members"
        />
        <StatCard
          icon={<IconKey />}
          concept="neutral"
          value={<KpiValue n={active.length} />}
          label="Active grants"
        />
        {/* A fact, not a figure: "Yes" in tabular digits read as a number that
            had lost them. */}
        <StatCard
          icon={<IconLedger />}
          tone={finance.declared ? "green" : "neutral"}
          value={finance.declared ? "Declared" : <span className="admin-zero">None</span>}
          label="Finance profile"
          {...(finance.declared && finance.posture !== null
            ? { hint: `Posture: ${finance.posture}` }
            : {})}
        />
      </StatGrid>

      <SectionCard
        icon={<IconTrophy />}
        title="Seasons"
        description={`${formatCount(competitions.length)} season${competitions.length === 1 ? "" : "s"} · status, visibility, auction and settlement`}
        flush
      >
        {competitions.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title="No seasons"
              description="This organization has not created one yet."
            />
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table da-rows" data-testid="admin-org-competitions">
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">Status</th>
                  <th scope="col">Visibility</th>
                  <th scope="col">Auction</th>
                  <th scope="col">Settlement</th>
                </tr>
              </thead>
              <tbody>
                {competitions.map((competition) => (
                  <tr key={competition.id}>
                    {/* /seasons/<slug> is a member's workspace and notFound()s
                        for a platform admin who is not in the club — every
                        season here was a dead link. The doors that DO open for
                        this reader: the public page when the season is public
                        (and not taken down), else the admin auction watch when
                        it has an auction, else just the name. */}
                    <td data-label="Season" data-cell="title">
                      {competition.visibility === "public" && !competition.held ? (
                        <Link href={`/c/${competition.slug}`} className="admin-name">
                          {competition.name}
                        </Link>
                      ) : competition.auctionId !== null ? (
                        <Link
                          href={`/admin/auctions/${competition.auctionId}`}
                          className="admin-name"
                        >
                          {competition.name}
                        </Link>
                      ) : (
                        <span className="admin-name">{competition.name}</span>
                      )}
                      {/* The phone's one line: the facts a laptop gives columns. */}
                      <span className="da-row-meta">
                        {[
                          competition.held ? "Taken down" : lifecycleLabel(competition.visibility),
                          competition.caseStatus === null
                            ? "No case"
                            : `Settlement ${lifecycleLabel(competition.caseStatus).toLowerCase()}`,
                        ].join(" · ")}
                      </span>
                    </td>
                    {/* Capability SETS are rendered verbatim on purpose; a
                        lifecycle state is not a set. "REGISTRATION_CLOSED" is
                        an un-translated database value, not a name anyone
                        needs to type back. */}
                    <td data-label="Status" data-cell="figure">
                      <Pill tone={statusPillTone(competition.status)} dot>
                        {lifecycleLabel(competition.status)}
                      </Pill>
                    </td>
                    <td data-label="Visibility">
                      {competition.held ? (
                        <Pill tone="red">Taken down</Pill>
                      ) : (
                        <Pill tone={competition.visibility === "public" ? "blue" : "neutral"}>
                          {lifecycleLabel(competition.visibility)}
                        </Pill>
                      )}
                    </td>
                    <td data-label="Auction" data-cell="status">
                      {competition.auctionStatus === null || competition.auctionId === null ? (
                        <span className="admin-dash">No auction</span>
                      ) : (
                        <Link
                          href={`/admin/auctions/${competition.auctionId}`}
                          className="admin-badge-link"
                          aria-label={`Watch this auction (${lifecycleLabel(competition.auctionStatus)})`}
                        >
                          <Pill tone={statusPillTone(competition.auctionStatus)} dot>
                            {lifecycleLabel(competition.auctionStatus)}
                          </Pill>
                        </Link>
                      )}
                    </td>
                    <td data-label="Settlement">
                      {competition.caseStatus === null ? (
                        <span className="admin-dash">No case</span>
                      ) : (
                        <Pill tone={statusPillTone(competition.caseStatus)} dot>
                          {lifecycleLabel(competition.caseStatus)}
                        </Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={<IconKey />}
        tone="purple"
        title="Grants"
        description="Who can do what here — each capability set exactly as it is held."
        flush
      >
        {grants.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title="No grants"
              description="Nobody holds authority on this organization."
            />
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table da-rows" data-testid="admin-org-grants">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Capability set</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id}>
                    <td data-label="Person" data-cell="title">
                      <Link href={`/admin/users/${grant.personId}`} className="admin-name">
                        {grant.name ?? grant.personId.slice(-6)}
                      </Link>
                      <span className="da-row-meta">{grant.capabilitySet}</span>
                    </td>
                    <td data-label="Capability set">
                      <span className="admin-action">{grant.capabilitySet}</span>
                    </td>
                    <td data-label="State" data-cell="figure">
                      {grant.revokedAt === null ? (
                        <Pill tone="green" dot>
                          Active
                        </Pill>
                      ) : (
                        <Pill tone="neutral">Revoked {absoluteIst(grant.revokedAt)}</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <CardGrid>
        <SectionCard icon={<IconUsers />} tone="blue" title="Members" flush>
          {members.length === 0 ? (
            <div className="admin-card-empty">
              <EmptyState
                size="compact"
                headingLevel={3}
                title="No members"
                description="Nobody has joined."
              />
            </div>
          ) : (
            <ul className="admin-rows" data-testid="admin-org-members">
              {members.map((member) => (
                <li key={member.personId}>
                  <span className="admin-cell-main">
                    {/* The name falls back to the masked contact, so the link
                        itself can carry one — masked in a screenshot too. */}
                    <Link
                      href={`/admin/users/${member.personId}`}
                      className="admin-name"
                      {...(member.name === null ? { "data-private": "" } : {})}
                    >
                      {member.name ?? maskPersonContact(member)}
                    </Link>
                    {/* A membership list is a directory; the whole number lives
                        on the one person's page. */}
                    <span className="admin-meta" data-private>
                      {maskPersonContact(member)}
                    </span>
                  </span>
                  <RelativeTime at={member.joinedAt} />
                </li>
              ))}
            </ul>
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
                    All audit for this organization
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
                description="No audited action on this organization."
              />
            </div>
          ) : (
            <ul className="admin-rows admin-rows-dense">
              {foldRuns(activity, (a, b) => a.action === b.action && a.actor === b.actor).map(
                ({ row, count }) => (
                  <li key={row.id}>
                    <span className="admin-activity-line">
                      <span className="admin-activity-what" title={row.action}>
                        {humanAction(row.action)}
                      </span>
                      {count > 1 ? <span className="admin-times">×{count}</span> : null}
                      <span className="admin-meta"> by {row.actorName ?? row.actor.slice(-6)}</span>
                    </span>
                    <RelativeTime at={row.at} />
                  </li>
                ),
              )}
            </ul>
          )}
        </SectionCard>
      </CardGrid>
    </>
  );
}
