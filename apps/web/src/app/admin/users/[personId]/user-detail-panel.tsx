import {
  EmptyState,
  IconArrowRight,
  IconClock,
  IconKey,
  IconLayers,
  IconTrophy,
  Pill,
  SectionCard,
} from "@desiauction/ui";
import { roleLabelIn, sportPackFor } from "@desiauction/core";
import Link from "next/link";

import { PageTitle } from "../../../../components/shell/page-title";
import { personContact } from "../../../../lib/person-label";
import { formatCount } from "../../../../server/admin/format";
import type { UserDetail } from "../../../../server/admin/views";
import {
  AdminPageHead,
  RelativeTime,
  absoluteIst,
  foldRuns,
  humanAction,
  monogram,
} from "../../admin-ui";
import { CopyId } from "../../copy-id";

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
      <AdminPageHead
        readOnly
        actions={
          <Link href="/admin/users" className="admin-head-button">
            All users
          </Link>
        }
      />

      {/* One profile card instead of a grey lede plus three one-third tiles
          (one of them a large "0"). */}
      <section className="admin-profile" aria-label="Profile">
        <span className="admin-monogram is-lg" aria-hidden>
          {monogram(person.name)}
        </span>
        <span className="admin-profile-main">
          {/* The ONE surface that shows the whole number — an operator arrived
              here on purpose, for one person. The directory shows four digits.
              `data-private` paints it over in a Report-a-problem screenshot. */}
          <span className="admin-profile-name">{person.name ?? "Unnamed"}</span>
          <span className="admin-profile-contact" data-private>
            {personContact(person)}
          </span>
          <span className="admin-meta admin-profile-id">
            <span className="admin-id admin-chip-id">{person.id}</span>
            <CopyId value={person.id} label="user id" />
            <span>· joined {absoluteIst(person.createdAt)}</span>
          </span>
        </span>
        <dl className="admin-profile-stats">
          <div>
            <dt>Organizations</dt>
            <dd data-zero={orgs.length === 0 || undefined}>{formatCount(orgs.length)}</dd>
          </div>
          <div>
            <dt>Active grants</dt>
            <dd data-zero={active.length === 0 || undefined}>{formatCount(active.length)}</dd>
          </div>
          <div>
            <dt>Revoked grants</dt>
            <dd data-zero={grants.length === active.length || undefined}>
              {formatCount(grants.length - active.length)}
            </dd>
          </div>
        </dl>
      </section>

      <SectionCard
        icon={<IconKey />}
        tone="neutral"
        title="Grants"
        description="Every grant this person holds, in every scope, as the capability set it is."
        flush
      >
        {grants.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title="No grants"
              description="This person holds no authority anywhere on the platform."
            />
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table da-rows" data-testid="admin-user-grants">
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
                    <td data-label="Scope" data-cell="title">
                      <span className="admin-cell-main">
                        <span className="admin-name">{grant.scopeLabel}</span>
                        <span className="admin-meta">{grant.scopeType}</span>
                      </span>
                      {/* The phone's one line under the scope. */}
                      <span className="da-row-meta">
                        {grant.scopeType} · {grant.capabilitySet} · {absoluteIst(grant.createdAt)}
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

      {/* Two columns that end together: what this person belongs to on the
          left (seasons, then clubs), what they did on the right. */}
      <div className="admin-split">
        <div className="admin-split-col">
          {/* PI-1 P6: the person's participations — read-only, no prices (money
              surfaces stay with the money capabilities). */}
          <SectionCard
            icon={<IconTrophy />}
            title="Seasons played"
            description={
              detail.seasons.length === 0 ? "None — this person has joined no season" : undefined
            }
            flush={detail.seasons.length > 0}
          >
            {detail.seasons.length === 0 ? undefined : (
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

          <SectionCard icon={<IconLayers />} tone="blue" title="Organizations" flush>
            {orgs.length === 0 ? (
              <div className="admin-card-empty">
                <EmptyState
                  size="compact"
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
        </div>
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
                size="compact"
                headingLevel={3}
                title="Nothing yet"
                description="This person has taken no audited action."
              />
            </div>
          ) : (
            <ul className="admin-rows admin-rows-dense">
              {foldRuns(activity, (a, b) => a.action === b.action).map(({ row, count }) => (
                <li key={row.id}>
                  <span className="admin-activity-line">
                    <span className="admin-activity-what" title={row.action}>
                      {humanAction(row.action)}
                    </span>
                    {count > 1 ? <span className="admin-times">×{count}</span> : null}
                  </span>
                  <RelativeTime at={row.at} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}
