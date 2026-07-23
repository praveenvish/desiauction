import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { playerIndex } from "../../server/home/workspace";
import "../workspace.css";

export const metadata = { title: "Players · DesiAuction" };

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

export default async function PlayersPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/players");
  }
  const players = await playerIndex(false);
  return (
    <main className="ws">
      <PageHeader
        title="Players"
        subtitle="Every approved player across your competitions."
      />
      <Card padding={players.length === 0 ? "default" : "dense"}>
        {players.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="No approved players yet"
            description="Players appear here once you approve their registration."
            action={<ButtonLink href="/registrations">Open the review queue</ButtonLink>}
          />
        ) : (
          <ul className="ws-list" data-testid="players-list">
            {players.map((player) => (
              <li key={player.id}>
                <Link
                  href={`/competitions/${player.competitionSlug}/registrations`}
                  className="ws-row"
                >
                  <span className="ws-crest" aria-hidden>
                    {initials(player.name)}
                  </span>
                  <span className="ws-text">
                    <strong>{player.name}</strong>
                    <span>
                      {player.role.replace(/_/g, " ")} · {player.competitionName}
                    </span>
                  </span>
                  <span className="ws-tags">
                    {player.isIcon ? <Badge tone="warning">Icon</Badge> : null}
                    {player.isCaptain ? <Badge tone="info">Captain</Badge> : null}
                  </span>
                  <span className="ws-meta">
                    <span className="ws-stat">
                      <b>{player.number ?? "—"}</b>
                      <span>Number</span>
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
