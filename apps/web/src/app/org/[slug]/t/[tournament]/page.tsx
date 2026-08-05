import { Badge } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageTitle } from "../../../../../components/shell/page-title";
import { dateRange, statusLabel, statusTone } from "../../../../tournaments/season-card";
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
      {/* The tournament's name is page data, so the shell's derived "Tournament"
          gives way to the real one here. */}
      <PageTitle title={view.tournament.name} testId="tournament-name" />
      <div className="org-stack">
        <div className="org-title-row">
          <span className="cat-group-count">
            {view.editions.length} {view.editions.length === 1 ? "season" : "seasons"}
          </span>
          {/* The only route to this tournament's workspace — where a season is
              actually added — used to sit inside the EMPTY state, so the moment
              a tournament had one season the way to add its second disappeared.
              An organizer's second year is the common case, not the rare one. */}
          <Link href={`/tournaments/${view.tournament.slug}`} className="cat-workspace-link">
            Open tournament workspace
          </Link>
        </div>

        {view.editions.length === 0 ? (
          <div className="cat-blank">
            <p>No season has been run under this name yet.</p>
            {/* The tournament's own page, not the index: "+ Season" there is
                already scoped to THIS tournament, so the edition it creates
                lands under the name the reader is standing on. */}
            <Link href={`/tournaments/${view.tournament.slug}`} className="cat-blank-cta">
              Create the first season
            </Link>
          </div>
        ) : (
          <article className="cat-group">
            <ul className="cat-list">
              {view.editions.map((edition) => (
                <li key={edition.id}>
                  <Link href={`/seasons/${edition.slug}`} className="cat-edition">
                    <span className="cat-edition-name">{edition.name}</span>
                    <span className="cat-edition-meta">
                      {edition.teams} {edition.teams === 1 ? "team" : "teams"} · {edition.players}{" "}
                      {edition.players === 1 ? "player" : "players"}
                      {edition.location !== null ? ` · ${edition.location}` : ""}
                      {/* Was the raw column, `2026-08-01`. The sibling view of
                          these same rows renders "1 Aug – 15 Aug 2026" through
                          `dateRange`, which is exported for exactly this. */}
                      {dateRange(edition.startsOn, edition.endsOn) !== null
                        ? ` · ${dateRange(edition.startsOn, edition.endsOn) ?? ""}`
                        : ""}
                    </span>
                    {/* Four states, not two. This badge read
                        `status === "registration_open" ? "Open" : "Closed"`, so
                        a draft and a finished tournament were the same word. */}
                    <Badge tone={statusTone(edition.status)}>{statusLabel(edition.status)}</Badge>
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
