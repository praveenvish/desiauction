import { Badge, ButtonLink, Card, EmptyState } from "@desiauction/ui";
import { roleLabelIn, sportPackFor } from "@desiauction/core";
import Link from "next/link";

import { PageTitle } from "../../../../components/shell/page-title";
import { formatPhone } from "../../../../lib/format-phone";
import { formatCount } from "../../../../server/admin/format";
import type { UserDetail } from "../../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime, absoluteIst } from "../../admin-ui";

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
      <PageTitle title={person.name ?? "Unnamed"} />
      <header className="dash-head">
        <div className="competition-title-row title-row-actions">
          <span className="date-row">
            <ButtonLink href="/admin/users" variant="secondary">
              All users
            </ButtonLink>
          </span>
        </div>
        {/* The ONE surface that shows the whole number — an operator arrived
            here on purpose, for one person. The directory shows four digits. */}
        <p className="dash-hint">
          {formatPhone(person.phone)} · <span className="admin-id">{person.id}</span> · joined{" "}
          {absoluteIst(person.createdAt)}
        </p>
      </header>
      <ReadOnlyNotice />

      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-value">{formatCount(orgs.length)}</span>
          <span className="stat-label">Organizations</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{formatCount(active.length)}</span>
          <span className="stat-label">Active grants</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{formatCount(grants.length - active.length)}</span>
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
                  <th scope="col">Granted</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} className="reg-row">
                    <td data-label="Scope">
                      <span className="registration-name">{grant.scopeLabel}</span>
                      <span className="admin-meta">{grant.scopeType}</span>
                    </td>
                    <td data-label="Capability set">
                      <span className="admin-action">{grant.capabilitySet}</span>
                    </td>
                    {/* `createdAt` was queried and never rendered, so a grant —
                        the record of who trusted whom — had no date at all.
                        And the seed writes `granted_by` as the RECIPIENT, so
                        "Granted by Demo Founder" on Demo Founder's own platform
                        grant read as an admin granting themselves. It is a
                        self-reference, so it is named as one rather than
                        dressed up as a decision somebody made. */}
                    <td data-label="Granted">
                      <span className="admin-meta">{absoluteIst(grant.createdAt)}</span>{" "}
                      <span className="admin-meta">
                        {grant.grantedBy === person.id
                          ? "· installed out-of-band (self-referencing grantor)"
                          : `· by ${grant.grantedByName ?? grant.grantedBy.slice(-6)}`}
                      </span>
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

      {/* PI-1 P6: the person's participations — read-only, no prices (money
          surfaces stay with the money capabilities). */}
      <Card>
        <h2 className="admin-section-title">Seasons played</h2>
        {detail.seasons.length === 0 ? (
          <EmptyState title="No registrations" description="This person has joined no season." />
        ) : (
          <ul className="admin-timeline" data-testid="admin-user-seasons">
            {detail.seasons.map((season, index) => (
              <li key={index}>
                <span className="registration-name">{season.competitionName}</span>{" "}
                <span className="admin-meta">
                  {season.orgName}
                  {season.startsOn !== null ? ` · ${season.startsOn.slice(0, 4)}` : ""} ·{" "}
                  {roleLabelIn(sportPackFor(season.sport), season.role)} · {season.status}
                </span>
              </li>
            ))}
          </ul>
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
