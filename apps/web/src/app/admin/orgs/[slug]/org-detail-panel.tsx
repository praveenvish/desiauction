import { Badge, ButtonLink, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import type { OrgDetail } from "../../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime, statusTone } from "../../admin-ui";

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
      <header className="dash-head">
        <div className="competition-title-row">
          <h1>{org.name}</h1>
          <span className="date-row">
            <ButtonLink href={`/org/${org.slug}`} variant="secondary" data-testid="admin-open-org">
              Open console
            </ButtonLink>
            <ButtonLink href="/admin/orgs" variant="secondary">
              All organizations
            </ButtonLink>
          </span>
        </div>
        <p className="dash-hint">
          <span className="admin-id">{org.slug}</span> · created{" "}
          {org.createdAt.toISOString().slice(0, 10)}
        </p>
      </header>
      <ReadOnlyNotice />

      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-value">{competitions.length}</span>
          <span className="stat-label">Competitions</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{members.length}</span>
          <span className="stat-label">Members</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{active.length}</span>
          <span className="stat-label">Active grants</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{finance.declared ? "Yes" : "No"}</span>
          <span className="stat-label">Finance declared</span>
        </div>
      </div>

      <Card>
        <h2 className="admin-section-title">Competitions</h2>
        {competitions.length === 0 ? (
          <EmptyState
            title="No competitions"
            description="This organization has not created one yet."
          />
        ) : (
          <div className="table-scroll">
            <table className="reg-table" data-testid="admin-org-competitions">
              <thead>
                <tr>
                  <th scope="col">Competition</th>
                  <th scope="col">Status</th>
                  <th scope="col">Visibility</th>
                  <th scope="col">Auction</th>
                  <th scope="col">Settlement</th>
                </tr>
              </thead>
              <tbody>
                {competitions.map((competition) => (
                  <tr key={competition.id} className="reg-row">
                    <td>
                      <Link
                        href={`/competitions/${competition.slug}`}
                        className="registration-name"
                      >
                        {competition.name}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={statusTone(competition.status)}>{competition.status}</Badge>
                    </td>
                    <td>
                      <Badge tone={competition.visibility === "public" ? "info" : "neutral"}>
                        {competition.visibility}
                      </Badge>
                    </td>
                    <td>
                      {competition.auctionStatus === null ? (
                        <span className="admin-meta">—</span>
                      ) : (
                        <Badge tone={statusTone(competition.auctionStatus)}>
                          {competition.auctionStatus}
                        </Badge>
                      )}
                    </td>
                    <td>
                      {competition.caseStatus === null ? (
                        <span className="admin-meta">—</span>
                      ) : (
                        <Badge tone={statusTone(competition.caseStatus)}>
                          {competition.caseStatus}
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
                    <td>
                      <Link href={`/admin/users/${grant.personId}`} className="registration-name">
                        {grant.name ?? grant.personId.slice(-6)}
                      </Link>
                    </td>
                    <td>
                      <span className="admin-action">{grant.capabilitySet}</span>
                    </td>
                    <td>
                      {grant.revokedAt === null ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Revoked</Badge>
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
                      {member.name ?? member.phone}
                    </Link>
                    <span className="admin-meta">{member.phone}</span>
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
