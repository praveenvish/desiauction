import { Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import { myOrgs } from "../../server/orgs/actions";
import { CreateOrgForm } from "./create-org-form";
import "./orgs.css";

export const metadata = { title: "Organizations · DesiAuction" };

export default async function OrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const [orgs, params] = await Promise.all([myOrgs(), searchParams]);
  return (
    <main className="orgs">
      <div className="orgs-stack">
        <h1>Your organizations</h1>
        {params.invite === "invalid" ? (
          <p className="orgs-error" role="alert">
            That invite link is no longer valid — ask the organizer for a fresh one.
          </p>
        ) : null}
        {orgs.length === 0 ? (
          <Card>
            <EmptyState
              headingLevel={2}
              title="No organizations yet"
              description="Create one to run tournaments, or ask an organizer for an invite link."
            />
          </Card>
        ) : (
          <div className="orgs-grid" data-testid="orgs-list">
            {orgs.map((org) => (
              <Link key={org.id} href={`/org/${org.slug}`} className="org-link">
                <Card>
                  <strong>{org.name}</strong>
                  <span className="org-slug">/{org.slug}</span>
                </Card>
              </Link>
            ))}
          </div>
        )}
        <Card>
          <h2>Create an organization</h2>
          <CreateOrgForm />
        </Card>
      </div>
    </main>
  );
}
