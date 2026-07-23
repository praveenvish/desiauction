import { ButtonLink, Card, EmptyState, PageHeader } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { playerIndex } from "../../server/home/workspace";
import "../workspace.css";

export const metadata = { title: "Registrations · DesiAuction" };

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "—"
  );
}

export default async function RegistrationsPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/registrations");
  }
  const pending = await playerIndex(true);
  return (
    <main className="ws">
      <PageHeader
        title="Registrations"
        subtitle="Everyone waiting on a decision, across every competition."
      />
      <Card padding={pending.length === 0 ? "default" : "dense"}>
        {pending.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="Nothing to review"
            description="Every registration has been decided. New submissions land here."
            action={<ButtonLink href="/competitions">Back to competitions</ButtonLink>}
          />
        ) : (
          <ul className="ws-list" data-testid="registrations-list">
            {pending.map((row) => (
              <li key={row.id}>
                <Link href={`/competitions/${row.competitionSlug}/registrations`} className="ws-row">
                  <span className="ws-crest" aria-hidden>
                    {initials(row.name)}
                  </span>
                  <span className="ws-text">
                    <strong>{row.name}</strong>
                    <span>
                      {row.role.replace(/_/g, " ")} · {row.competitionName}
                    </span>
                  </span>
                  <span className="ws-meta">
                    <span className="ws-stat">
                      <b>Review</b>
                      <span>Pending</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
