import { Badge, Card } from "@desiauction/ui";
import Link from "next/link";

import type { CompetitionSummary } from "../../server/competition/competitions";

// The season card, extracted so the tournaments index and the seasons index
// render an edition identically. It was inline in /seasons; a second copy would
// have been the fourth place this product draws the same object differently.

const STATUS_TONE = {
  draft: "neutral",
  setup: "info",
  registration_open: "success",
  registration_closed: "warning",
} as const;

const STATUS_LABEL = {
  draft: "Draft",
  setup: "In setup",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
} as const;

/** "1 Aug – 15 Aug 2026", or a single dated end, or nothing. Days arrive as ISO. */
export function dateRange(startsOn: string | null, endsOn: string | null): string | null {
  const day = (iso: string, withYear: boolean): string =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  if (startsOn === null && endsOn === null) {
    return null;
  }
  if (startsOn === null) {
    return day(endsOn ?? "", true);
  }
  if (endsOn === null) {
    return day(startsOn, true);
  }
  return `${day(startsOn, false)} – ${day(endsOn, true)}`;
}

export function SeasonCard({ season }: { season: CompetitionSummary & { orgName?: string } }) {
  const when = dateRange(season.startsOn, season.endsOn);
  const hasMeta = when !== null || season.location !== null;
  return (
    <Link href={`/seasons/${season.slug}`} className="competition-link">
      <Card padding="none">
        <article className="season-card">
          <div className="season-card-top">
            <Badge tone={STATUS_TONE[season.status]}>{STATUS_LABEL[season.status]}</Badge>
          </div>
          <strong>{season.name}</strong>
          {season.orgName !== undefined ? (
            <span className="competition-org">{season.orgName}</span>
          ) : null}
          {hasMeta ? (
            <dl className="season-card-meta">
              {when !== null ? (
                <div>
                  <dt>When</dt>
                  <dd>{when}</dd>
                </div>
              ) : null}
              {season.location !== null ? (
                <div>
                  <dt>Where</dt>
                  <dd>{season.location}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </article>
      </Card>
    </Link>
  );
}
