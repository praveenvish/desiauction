import { ButtonLink, Card, EmptyState, PageHeader } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { teamIndex } from "../../server/home/workspace";
import "../workspace.css";

export const metadata = { title: "Teams · DesiAuction" };

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

export default async function TeamsPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/teams");
  }
  const rows = await teamIndex();
  return (
    <main className="ws">
      <PageHeader title="Teams" subtitle="Every team across your competitions." />
      <Card padding={rows.length === 0 ? "default" : "dense"}>
        {rows.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="No teams yet"
            description="Add teams inside a competition — they bid for players on auction night."
            action={<ButtonLink href="/competitions">Open competitions</ButtonLink>}
          />
        ) : (
          <ul className="ws-list" data-testid="teams-list">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/competitions/${row.competitionSlug}/teams`} className="ws-row">
                  <span className="ws-crest" aria-hidden>
                    {row.shortName ?? initials(row.name)}
                  </span>
                  <span className="ws-text">
                    <strong>{row.name}</strong>
                    <span>
                      {row.competitionName}
                      {row.coachName !== null ? ` · Coach ${row.coachName}` : ""}
                    </span>
                  </span>
                  <span className="ws-meta">
                    <span className="ws-stat">
                      <b>{row.players}</b>
                      <span>Squad</span>
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
