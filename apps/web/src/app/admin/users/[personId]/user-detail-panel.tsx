import {
  ButtonLink,
  CardGrid,
  EmptyState,
  IconArrowRight,
  IconClock,
  IconKey,
  IconLayers,
  IconLock,
  IconTrophy,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
} from "@desiauction/ui";
import { roleLabelIn, sportPackFor } from "@desiauction/core";
import Link from "next/link";

import { PageTitle } from "../../../../components/shell/page-title";
import { personContact } from "../../../../lib/person-label";
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
      <header className="dash-head admin-head">
        <div className="admin-head-text">
          {/* The ONE surface that shows the whole number — an operator arrived
              here on purpose, for one person. The directory shows four digits.
              `data-private` paints it over in a Report-a-problem screenshot. */}
          <p className="dash-hint">
            <span data-private>{personContact(person)}</span> ·{" "}
            <span className="admin-id">{person.id}</span> · joined {absoluteIst(person.createdAt)}
          </p>
        </div>
        <div className="admin-head-actions">
          <ButtonLink href="/admin/users" variant="secondary">
            All users
          </ButtonLink>
        </div>
      </header>
      <ReadOnlyNotice />

      <StatGrid>
        <StatCard
          icon={<IconLayers />}
          tone="blue"
          value={formatCount(orgs.length)}
          label="Organizations"
        />
        <StatCard
          icon={<IconKey />}
          tone="green"
          value={formatCount(active.length)}
          label="Active grants"
        />
        <StatCard
          icon={<IconLock />}
          tone="neutral"
          value={formatCount(grants.length - active.length)}
          label="Revoked grants"
        />
      </StatGrid>

      <SectionCard
        icon={<IconKey />}
        tone="purple"
        title="Grants"
        description="Every grant this person holds, in every scope, as the capability set it is."
        flush
      >
        {grants.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              headingLevel={3}
              title="No grants"
              description="This person holds no authority anywhere on the platform."
            />
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" data-testid="admin-user-grants">
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
                  <tr key={grant.id}>
                    <td data-label="Scope">
                      <span className="admin-cell-main">
                        <span className="admin-name">{grant.scopeLabel}</span>
                        <span className="admin-meta">{grant.scopeType}</span>
                      </span>
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
                      <span className="admin-cell-main">
                        <span className="admin-meta">{absoluteIst(grant.createdAt)}</span>
                        <span className="admin-meta">
                          {grant.grantedBy === person.id
                            ? "installed out-of-band (self-referencing grantor)"
                            : `by ${grant.grantedByName ?? grant.grantedBy.slice(-6)}`}
                        </span>
                      </span>
                    </td>
                    <td data-label="State">
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

      {/* PI-1 P6: the person's participations — read-only, no prices (money
          surfaces stay with the money capabilities). */}
      <SectionCard icon={<IconTrophy />} title="Seasons played" flush>
        {detail.seasons.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              headingLevel={3}
              title="No registrations"
              description="This person has joined no season."
            />
          </div>
        ) : (
          <ul className="admin-rows" data-testid="admin-user-seasons">
            {detail.seasons.map((season, index) => (
              <li key={index}>
                <span className="admin-cell-main">
                  <span className="admin-name">{season.competitionName}</span>
                  <span className="admin-meta">
                    {season.orgName}
                    {season.startsOn !== null ? ` · ${season.startsOn.slice(0, 4)}` : ""} ·{" "}
                    {roleLabelIn(sportPackFor(season.sport), season.role)}
                  </span>
                </span>
                <Pill tone="neutral">{season.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <CardGrid>
        <SectionCard icon={<IconLayers />} tone="blue" title="Organizations" flush>
          {orgs.length === 0 ? (
            <div className="admin-card-empty">
              <EmptyState
                headingLevel={3}
                title="No memberships"
                description="This person belongs to no organization."
              />
            </div>
          ) : (
            <ul className="admin-rows" data-testid="admin-user-orgs">
              {orgs.map((org) => (
                <li key={org.slug}>
                  <span>
                    <Link href={`/admin/orgs/${org.slug}`} className="admin-name">
                      {org.name}
                    </Link>
                  </span>
                  <RelativeTime at={org.joinedAt} />
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
                  <Link href={`/admin/audit?actor=${person.id}`} className="admin-card-link">
                    Everything this person did
                    <IconArrowRight size={16} className="icon-trail" />
                  </Link>
                ),
              }
            : {})}
        >
          {activity.length === 0 ? (
            <div className="admin-card-empty">
              <EmptyState
                headingLevel={3}
                title="Nothing yet"
                description="This person has taken no audited action."
              />
            </div>
          ) : (
            <ul className="admin-rows">
              {activity.map((row) => (
                <li key={row.id}>
                  <span className="admin-action">{row.action}</span>
                  <RelativeTime at={row.at} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </CardGrid>
    </>
  );
}
