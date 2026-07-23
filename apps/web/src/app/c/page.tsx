import { Badge, Button, ButtonLink, Card, EmptyState, Field } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../env";
import { publicCompetitionsDirectory } from "../../server/competition/public";
import { IconCalendar, IconMapPin } from "../../components/marketing/icons";
import { formatDateRange } from "./format";
import "../marketing.css";
import "./directory.css";

export const metadata: Metadata = {
  title: "Tournaments · DesiAuction",
  description:
    "Community cricket tournaments running on DesiAuction — find one near you and register as a player.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/c` },
  openGraph: {
    title: "Tournaments on DesiAuction",
    description: "Find a community cricket season and register as a player.",
    url: `${env.PUBLIC_BASE_URL}/c`,
    type: "website",
  },
};

/** Deterministic art mood per slug — a tournament keeps its colors. */
function artIndex(slug: string): number {
  let hash = 0;
  for (const char of slug) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return hash % 4;
}

/** Monogram for the banner mark: first letters of the first two words. */
function monogram(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

// PX-5 public discovery: only tournaments their organizers PUBLISHED
// (visibility='public') appear here. Search and pagination are URL-backed.
export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Number.parseInt(sp.page ?? "1", 10);
  const directory = await publicCompetitionsDirectory({
    ...(sp.q !== undefined ? { q: sp.q } : {}),
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  });
  return (
    <main className="public-page mk">
      <header className="public-head">
        <div className="mk-container">
          <p className="mk-kicker">Public directory</p>
          <h1>Tournaments</h1>
          <p className="public-sub">
            Community tournaments running on DesiAuction. Found yours? Open it and register.
          </p>
          <form className="public-search" action="/c" method="get">
            <Field
              label="Search"
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Tournament, club or city"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </div>
      </header>
      <div className="public-body">
        <div className="mk-container">
          {directory.entries.length === 0 ? (
            <Card>
              <EmptyState
                headingLevel={2}
                title={
                  sp.q !== undefined && sp.q !== ""
                    ? "Nothing matches"
                    : "No public tournaments yet"
                }
                description={
                  sp.q !== undefined && sp.q !== ""
                    ? "Try a shorter word, or ask your organizer for their direct link."
                    : "Organizers publish their tournaments here. If you were given a direct link, it still works."
                }
              />
            </Card>
          ) : (
            <div className="public-grid" data-testid="directory-list">
              {directory.entries.map((entry) => (
                <Link key={entry.slug} href={`/c/${entry.slug}`} className="public-card-link">
                  <article className="public-card">
                    <div className="public-card-art" data-art={artIndex(entry.slug)} aria-hidden>
                      {entry.logoUrl !== null ? (
                        <img
                          className="public-card-logo"
                          src={entry.logoUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="public-card-mark">{monogram(entry.name)}</span>
                      )}
                    </div>
                    <div className="public-card-body">
                      <span className="public-card-name">{entry.name}</span>
                      <span className="public-card-sub">{entry.orgName}</span>
                      {entry.location !== null ? (
                        <span className="public-card-sub">
                          <IconMapPin />
                          {entry.location}
                        </span>
                      ) : null}
                      <span className="public-card-sub">
                        <IconCalendar />
                        {formatDateRange(entry.startsOn, entry.endsOn)}
                      </span>
                      <span className="public-card-foot">
                        <Badge tone={entry.open ? "success" : "neutral"}>
                          {entry.open ? "Registration open" : "Registration closed"}
                        </Badge>
                      </span>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
          {directory.totalPages > 1 ? (
            <nav className="public-pagination" aria-label="Pagination">
              {directory.page > 1 ? (
                <ButtonLink
                  variant="ghost"
                  href={`/c?${new URLSearchParams({ ...(sp.q !== undefined ? { q: sp.q } : {}), page: String(directory.page - 1) }).toString()}`}
                >
                  Previous
                </ButtonLink>
              ) : null}
              <span>
                Page {directory.page} of {directory.totalPages}
              </span>
              {directory.page < directory.totalPages ? (
                <ButtonLink
                  variant="ghost"
                  href={`/c?${new URLSearchParams({ ...(sp.q !== undefined ? { q: sp.q } : {}), page: String(directory.page + 1) }).toString()}`}
                >
                  Next
                </ButtonLink>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </main>
  );
}
