import { Badge, Card, IconCalendar, IconPin, VisuallyHidden } from "@desiauction/ui";
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

export function SeasonCard({
  season,
}: {
  season: CompetitionSummary & { orgName?: string; running?: boolean };
}) {
  const when = dateRange(season.startsOn, season.endsOn);
  const hasMeta = when !== null || season.location !== null;
  return (
    <Link href={`/seasons/${season.slug}`} className="competition-link">
      <Card padding="none">
        <article className="season-card">
          <div className="season-card-top">
            {/* "Which edition am I running?" is the question this page exists to
                answer, and the page had no visual answer at all. */}
            {season.running === true ? <Badge tone="live">Now running</Badge> : null}
            <Badge tone={STATUS_TONE[season.status]}>{STATUS_LABEL[season.status]}</Badge>
          </div>
          <strong>{season.name}</strong>
          {season.orgName !== undefined ? (
            <span className="competition-org">{season.orgName}</span>
          ) : null}
          {/* The `dt`s stay in the markup as the accessible names for their
              values, but the visible words are gone: an uppercase "WHEN" above
              a date, and "WHERE" above a place name, caption something nobody
              was going to misread. The icons carry it silently. */}
          {hasMeta ? (
            <dl className="season-card-meta">
              {when !== null ? (
                <div>
                  <dt>
                    <IconCalendar width={14} height={14} aria-hidden />
                    <VisuallyHidden>When</VisuallyHidden>
                  </dt>
                  <dd>{when}</dd>
                </div>
              ) : null}
              {season.location !== null ? (
                <div>
                  <dt>
                    <IconPin width={14} height={14} aria-hidden />
                    <VisuallyHidden>Where</VisuallyHidden>
                  </dt>
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
