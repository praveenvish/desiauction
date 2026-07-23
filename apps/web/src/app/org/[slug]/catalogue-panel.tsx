import { Badge, SectionHeader } from "@desiauction/ui";
import Link from "next/link";

import type { EditionRow, OrgCatalogue } from "../../../server/orgs/catalogue";

/**
 * The org's tournaments and the editions under each — the link that was missing
 * between an organization and the competitions it exists to run.
 *
 * A tournament ("BPL") is a name that recurs; an edition ("BPL 2") is the thing
 * that runs. Only editions carry status, teams and players, so only editions are
 * given numbers here.
 */

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

function statusTone(status: string): Tone {
  switch (status) {
    case "registration_open":
      return "success";
    case "registration_closed":
      return "warning";
    case "setup":
      return "info";
    default:
      return "neutral";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "registration_open":
      return "Open";
    case "registration_closed":
      return "Closed";
    case "setup":
      return "Setup";
    default:
      return "Draft";
  }
}

function Edition({ edition }: { edition: EditionRow }) {
  return (
    <li>
      <Link href={`/competitions/${edition.slug}`} className="cat-edition">
        <span className="cat-edition-name">{edition.name}</span>
        <span className="cat-edition-meta">
          {edition.teams} {edition.teams === 1 ? "team" : "teams"} · {edition.players}{" "}
          {edition.players === 1 ? "player" : "players"}
          {edition.startsOn !== null ? ` · ${edition.startsOn}` : ""}
        </span>
        <Badge tone={statusTone(edition.status)}>{statusLabel(edition.status)}</Badge>
      </Link>
    </li>
  );
}

export function CataloguePanel({ catalogue }: { catalogue: OrgCatalogue }) {
  const { tournaments, standalone, org } = catalogue;
  const nothing = tournaments.length === 0 && standalone.length === 0;

  return (
    <section className="cat" data-testid="org-catalogue">
      <SectionHeader
        title="Tournaments"
        actions={
          <Link href="/competitions" className="cat-more">
            All competitions
          </Link>
        }
      />

      {nothing ? (
        <div className="cat-blank">
          <p>This organization has not run a competition yet.</p>
          <Link href="/competitions" className="cat-blank-cta">
            Create the first one
          </Link>
        </div>
      ) : null}

      {tournaments.map((tournament) => (
        <article key={tournament.id} className="cat-group">
          <Link href={`/org/${org.slug}/t/${tournament.slug}`} className="cat-group-head">
            <span className="cat-group-name">{tournament.name}</span>
            <span className="cat-group-count">
              {tournament.editions.length}{" "}
              {tournament.editions.length === 1 ? "season" : "seasons"}
            </span>
          </Link>
          {tournament.editions.length === 0 ? (
            <p className="cat-group-empty">No season has been run under this name yet.</p>
          ) : (
            <ul className="cat-list">
              {tournament.editions.map((edition) => (
                <Edition key={edition.id} edition={edition} />
              ))}
            </ul>
          )}
        </article>
      ))}

      {standalone.length > 0 ? (
        <article className="cat-group">
          <div className="cat-group-head cat-group-head--plain">
            <span className="cat-group-name">One-off competitions</span>
            <span className="cat-group-count">{standalone.length}</span>
          </div>
          <ul className="cat-list">
            {standalone.map((edition) => (
              <Edition key={edition.id} edition={edition} />
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}
