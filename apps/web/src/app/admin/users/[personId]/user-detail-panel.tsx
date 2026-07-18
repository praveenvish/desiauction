import { Badge, ButtonLink, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import type { UserDetail } from "../../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime } from "../../admin-ui";

/**
 * PX-9 §3 — the user inspector.
 *
 * The grants table is the whole point. It shows every grant this person holds
 * across every scope, as the capability SET it is — because the four engines
 * partition the capability space, `org:owner` on one org tells you nothing
 * about their money powers on another, and only the full list is the truth.
 * The platform grant, if they hold one, appears here like any other row: the
 * platform is a scope, and staff authority is as visible as everyone else's.
 */
export function UserDetailPanel({ detail }: { detail: UserDetail }) {
  const { person, orgs, grants, activity } = detail;
  const active = grants.filter((grant) => grant.revokedAt === null);
  return (
    <>
      <header className="dash-head">
        <div className="competition-title-row">
          <h1>{person.name ?? "Unnamed"}</h1>
          <span className="date-row">
            <ButtonLink href="/admin/users" variant="secondary">
              All users
            </ButtonLink>
          </span>
        </div>
        <p className="dash-hint">
          {person.phone} · <span className="admin-id">{person.id}</span> · joined{" "}
          {person.createdAt.toISOString().slice(0, 10)}
        </p>
      </header>
      <ReadOnlyNotice />

      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-value">{orgs.length}</span>
          <span className="stat-label">Organizations</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{active.length}</span>
          <span className="stat-label">Active grants</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{grants.length - active.length}</span>
          <span className="stat-label">Revoked grants</span>
        </div>
      </div>

      <Card>
        <h2 className="admin-section-title">Grants</h2>
        {grants.length === 0 ? (
          <EmptyState
            title="No grants"
            description="This person holds no authority anywhere on the platform."
          />
        ) : (
          <div className="table-scroll">
            <table className="reg-table" data-testid="admin-user-grants">
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">Capability set</th>
                  <th scope="col">Granted by</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} className="reg-row">
                    <td>
                      <span className="registration-name">{grant.scopeLabel}</span>
                      <span className="admin-meta">{grant.scopeType}</span>
                    </td>
                    <td>
                      <span className="admin-action">{grant.capabilitySet}</span>
                    </td>
                    <td>
                      <span className="admin-meta">
                        {grant.grantedByName ?? grant.grantedBy.slice(-6)}
                      </span>
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
          <h2 className="admin-section-title">Organizations</h2>
          {orgs.length === 0 ? (
            <EmptyState
              title="No memberships"
              description="This person belongs to no organization."
            />
          ) : (
            <ul className="admin-timeline" data-testid="admin-user-orgs">
              {orgs.map((org) => (
                <li key={org.slug}>
                  <Link href={`/admin/orgs/${org.slug}`} className="registration-name">
                    {org.name}
                  </Link>
                  <RelativeTime at={org.joinedAt} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="admin-section-title">Recent activity</h2>
          {activity.length === 0 ? (
            <EmptyState
              title="Nothing yet"
              description="This person has taken no audited action."
            />
          ) : (
            <>
              <ul className="admin-timeline">
                {activity.map((row) => (
                  <li key={row.id}>
                    <span className="admin-action">{row.action}</span>
                    <RelativeTime at={row.at} />
                  </li>
                ))}
              </ul>
              <Link href={`/admin/audit?actor=${person.id}`} className="admin-meta">
                Everything this person did →
              </Link>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
