import { Badge } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { tournamentView } from "../../../../../server/orgs/catalogue";
import "../../../../orgs/orgs.css";

export const metadata = { title: "Tournament · DesiAuction" };

/**
 * One tournament and every season run under it. The tournament itself has no
 * state to show — it is a name that recurs — so the page is the list of seasons
 * and the way back up to the organization that runs it.
 */
export default async function TournamentPage({
  params,
}: {
  params: Promise<{ slug: string; tournament: string }>;
}) {
  const { slug, tournament } = await params;
  const view = await tournamentView(slug, tournament);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (M-IP2-3 tenancy).
    notFound();
  }

  return (
    <main className="org-home">
      <div className="org-stack">
        <div className="org-title-row">
          <h1 data-testid="tournament-name">{view.tournament.name}</h1>
          <span className="cat-group-count">
            {view.editions.length} {view.editions.length === 1 ? "season" : "seasons"}
          </span>
        </div>

        {view.editions.length === 0 ? (
          <div className="cat-blank">
            <p>No season has been run under this name yet.</p>
            <Link href="/competitions" className="cat-blank-cta">
              Create the first season
            </Link>
          </div>
        ) : (
          <article className="cat-group">
            <ul className="cat-list">
              {view.editions.map((edition) => (
                <li key={edition.id}>
                  <Link href={`/competitions/${edition.slug}`} className="cat-edition">
                    <span className="cat-edition-name">{edition.name}</span>
                    <span className="cat-edition-meta">
                      {edition.teams} {edition.teams === 1 ? "team" : "teams"} · {edition.players}{" "}
                      {edition.players === 1 ? "player" : "players"}
                      {edition.location !== null ? ` · ${edition.location}` : ""}
                      {edition.startsOn !== null ? ` · ${edition.startsOn}` : ""}
                    </span>
                    <Badge tone={edition.status === "registration_open" ? "success" : "neutral"}>
                      {edition.status === "registration_open" ? "Open" : "Closed"}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </article>
        )}
      </div>
    </main>
  );
}
