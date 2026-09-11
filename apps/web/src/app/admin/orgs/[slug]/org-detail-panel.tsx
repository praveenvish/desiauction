import { Badge, ButtonLink, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import { PageTitle } from "../../../../components/shell/page-title";
import { formatCount, lifecycleLabel, maskPersonContact } from "../../../../server/admin/format";
import type { OrgDetail } from "../../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime, absoluteIst, statusTone } from "../../admin-ui";

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
      <header className="dash-head">
        <div className="competition-title-row title-row-actions">
          <span className="date-row">
            {/* Opens only for someone who also holds org capability HERE —
                `platform:admin` confers none. Named beside the door rather
                than discovered as a 404 behind it. */}
            <ButtonLink href={`/org/${org.slug}`} variant="secondary" data-testid="admin-open-org">
              Open console
            </ButtonLink>
            <ButtonLink href="/admin/orgs" variant="secondary">
              All organizations
            </ButtonLink>
          </span>
        </div>
        <p className="dash-hint">
          <span className="admin-id">{org.slug}</span> · created {absoluteIst(org.createdAt)}
        </p>
        <p className="admin-meta">
          The console link needs organizer permissions on this organization; a platform grant
          confers none.
        </p>
      </header>
      <ReadOnlyNotice />

      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-value">{formatCount(competitions.length)}</span>
          <span className="stat-label">Seasons</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{formatCount(members.length)}</span>
          <span className="stat-label">Members</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{formatCount(active.length)}</span>
          <span className="stat-label">Active grants</span>
        </div>
        {/* "Yes" set in 24px tabular-nums read as a number that had lost its
            digits. A fact is a badge, not a figure. */}
        <div className="stat-tile admin-fact">
          <span className="stat-label">Finance</span>
          {finance.declared ? (
            <Badge tone="info">
              Declared{finance.posture === null ? "" : ` · ${finance.posture}`}
            </Badge>
          ) : (
            <Badge tone="neutral">Not declared</Badge>
          )}
        </div>
      </div>

      <Card>
        <h2 className="admin-section-title">Seasons</h2>
        {competitions.length === 0 ? (
          <EmptyState title="No seasons" description="This organization has not created one yet." />
        ) : (
          <div className="table-scroll">
            <table className="reg-table" data-testid="admin-org-competitions">
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
                  <tr key={competition.id} className="reg-row">
                    <td data-label="Season">
                      <Link href={`/seasons/${competition.slug}`} className="registration-name">
                        {competition.name}
                      </Link>
                    </td>
                    {/* Capability SETS are rendered verbatim on purpose; a
                        lifecycle state is not a set. "REGISTRATION_CLOSED" is
                        an un-translated database value, not a name anyone
                        needs to type back. */}
                    <td data-label="Status">
                      <Badge tone={statusTone(competition.status)}>
                        {lifecycleLabel(competition.status)}
                      </Badge>
                    </td>
                    <td data-label="Visibility">
                      <Badge tone={competition.visibility === "public" ? "info" : "neutral"}>
                        {lifecycleLabel(competition.visibility)}
                      </Badge>
                    </td>
                    <td data-label="Auction">
                      {competition.auctionStatus === null ? (
                        <span className="admin-meta">No auction</span>
                      ) : (
                        <Badge tone={statusTone(competition.auctionStatus)}>
                          {lifecycleLabel(competition.auctionStatus)}
                        </Badge>
                      )}
                    </td>
                    <td data-label="Settlement">
                      {competition.caseStatus === null ? (
                        <span className="admin-meta">No case</span>
                      ) : (
                        <Badge tone={statusTone(competition.caseStatus)}>
                          {lifecycleLabel(competition.caseStatus)}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="admin-section-title">Grants</h2>
        {grants.length === 0 ? (
          <EmptyState
            title="No grants"
            description="Nobody holds authority on this organization."
          />
        ) : (
          <div className="table-scroll">
            <table className="reg-table" data-testid="admin-org-grants">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Capability set</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} className="reg-row">
                    <td data-label="Person">
                      <Link href={`/admin/users/${grant.personId}`} className="registration-name">
                        {grant.name ?? grant.personId.slice(-6)}
                      </Link>
                    </td>
                    <td data-label="Capability set">
                      <span className="admin-action">{grant.capabilitySet}</span>
                    </td>
                    <td data-label="State">
                      {grant.revokedAt === null ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Revoked {absoluteIst(grant.revokedAt)}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="admin-grid">
        <Card>
          <h2 className="admin-section-title">Members</h2>
          {members.length === 0 ? (
            <EmptyState title="No members" description="Nobody has joined." />
          ) : (
            <ul className="admin-timeline" data-testid="admin-org-members">
              {members.map((member) => (
                <li key={member.personId}>
                  <span>
                    <Link href={`/admin/users/${member.personId}`} className="registration-name">
                      {member.name ?? maskPersonContact(member)}
                    </Link>
                    {/* A membership list is a directory; the whole number lives on the
                        one person's page. */}
                    <span className="admin-meta">{maskPersonContact(member)}</span>
                  </span>
                  <RelativeTime at={member.joinedAt} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="admin-section-title">Recent activity</h2>
          {activity.length === 0 ? (
            <EmptyState title="Nothing yet" description="No audited action on this organization." />
          ) : (
            <>
              <ul className="admin-timeline">
                {activity.map((row) => (
                  <li key={row.id}>
                    <span>
                      <span className="admin-action">{row.action}</span>
                      <span className="admin-meta"> by {row.actorName ?? row.actor.slice(-6)}</span>
                    </span>
                    <RelativeTime at={row.at} />
                  </li>
                ))}
              </ul>
              <Link href={`/admin/audit?scopeId=${org.id}`} className="admin-meta">
                All audit for this organization →
              </Link>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
