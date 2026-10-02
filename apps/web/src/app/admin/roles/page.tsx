import { EmptyState, LoadingState, Pill, SectionCard } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminRoles } from "../../../server/admin/actions";
import { platformGrantPageGate } from "../../../server/admin/authz";
import { AdminPageHead, RelativeTime } from "../admin-ui";
import { InvitePerson } from "../people/person-actions";
import { ROLE_OPTIONS, roleLabel } from "../people/role-options";
import "../../seasons/seasons.css";
import "../admin.css";

export const metadata = { title: "Roles · Platform admin" };

/**
 * AC-1.2 — WHO HOLDS WHAT ON THE PLATFORM. The superadmin's page: every
 * platform role and its holders, the invitations still waiting for a first
 * sign-in, and the history of every grant and revocation. Changing a role is
 * done on the person's own page, where the person is in front of you.
 */
export default async function AdminRolesPage() {
  if ((await platformGrantPageGate("roles")) === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <AdminPageHead actions={<InvitePerson options={ROLE_OPTIONS} />}>
          Who can act on the platform. To give or remove a role, open the person.
        </AdminPageHead>
        <Suspense fallback={<LoadingState variant="page" />}>
          <Roles />
        </Suspense>
      </div>
    </main>
  );
}

async function Roles() {
  const view = await adminRoles();
  if (view === null) {
    notFound();
  }
  return (
    <>
      <div className="admin-roles-grid" data-testid="admin-roles">
        {view.holders.map(({ set, people }) => (
          <SectionCard
            key={set}
            title={roleLabel(set)}
            description={
              ROLE_OPTIONS.find((option) => option.set === set)?.what ??
              "gives and takes the roles above (only the seed script changes this one)"
            }
            data-testid={`admin-role-${set}`}
          >
            {people.length === 0 ? (
              <p className="admin-meta">Nobody holds this role.</p>
            ) : (
              <ul className="admin-role-holders">
                {people.map((holder) => (
                  <li key={holder.personId}>
                    <Link href={`/admin/people/${holder.personId}`}>
                      {holder.name ?? "Unnamed"}
                    </Link>{" "}
                    <span className="admin-meta" data-private>
                      {holder.contact}
                    </span>{" "}
                    <span className="admin-meta">
                      · since <RelativeTime at={holder.since} />
                      {holder.grantedByName === null ? "" : ` · by ${holder.grantedByName}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ))}
      </div>

      <SectionCard title="Waiting for a first sign-in" data-testid="admin-invites">
        {view.invites.length === 0 ? (
          <EmptyState size="compact" headingLevel={3} title="No invitations waiting" />
        ) : (
          <ul className="admin-role-holders">
            {view.invites.map((invite) => (
              <li key={invite.id}>
                <strong>{invite.name}</strong>{" "}
                <span className="admin-meta" data-private>
                  {invite.contact}
                </span>{" "}
                {invite.sets.map((set) => (
                  <Pill key={set} tone="blue">
                    {roleLabel(set)}
                  </Pill>
                ))}{" "}
                <span className="admin-meta">
                  · invited <RelativeTime at={invite.createdAt} />
                  {invite.invitedByName === null ? "" : ` by ${invite.invitedByName}`} · lapses{" "}
                  <RelativeTime at={invite.expiresAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="History" description="The last 100 role changes, newest first.">
        {view.history.length === 0 ? (
          <EmptyState size="compact" headingLevel={3} title="No changes yet" />
        ) : (
          <ul className="admin-role-holders" data-testid="admin-role-history">
            {view.history.map((row, index) => (
              <li key={index}>
                <Link href={`/admin/people/${row.personId}`}>{row.name ?? "Unnamed"}</Link>{" "}
                {row.revokedAt === null ? "was given" : "lost"}{" "}
                <strong>{roleLabel(row.set)}</strong>{" "}
                <span className="admin-meta">
                  · <RelativeTime at={row.revokedAt ?? row.createdAt} />
                  {row.revokedAt === null && row.grantedByName !== null
                    ? ` · by ${row.grantedByName}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
