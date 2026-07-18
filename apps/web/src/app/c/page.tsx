import { Badge, Button, ButtonLink, Card, EmptyState, Field } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { env } from "../../env";
import { publicCompetitionsDirectory } from "../../server/competition/public";
import { formatDateRange } from "./format";
import "./directory.css";

export const metadata: Metadata = {
  title: "Competitions · DesiAuction",
  description:
    "Community cricket competitions running on DesiAuction — find one near you and register as a player.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/c` },
  openGraph: {
    title: "Competitions on DesiAuction",
    description: "Find a community cricket competition and register as a player.",
    url: `${env.PUBLIC_BASE_URL}/c`,
    type: "website",
  },
};

// PX-5 public discovery: only competitions their organizers PUBLISHED
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
    <main className="public-page">
      <h1>Competitions</h1>
      <p className="public-sub">
        Community tournaments running on DesiAuction. Found yours? Open it and register.
      </p>
      <form className="public-search" action="/c" method="get">
        <Field
          label="Search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Competition, club or city"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {directory.entries.length === 0 ? (
        <Card>
          <EmptyState
            headingLevel={2}
            title={
              sp.q !== undefined && sp.q !== "" ? "Nothing matches" : "No public competitions yet"
            }
            description={
              sp.q !== undefined && sp.q !== ""
                ? "Try a shorter word, or ask your organizer for their direct link."
                : "Organizers publish their competitions here. If you were given a direct link, it still works."
            }
          />
        </Card>
      ) : (
        <div className="public-grid" data-testid="directory-list">
          {directory.entries.map((entry) => (
            <Link key={entry.slug} href={`/c/${entry.slug}`} className="public-card-link">
              <Card>
                <strong>{entry.name}</strong>
                <span className="public-card-sub">
                  {entry.orgName}
                  {entry.location !== null ? ` · ${entry.location}` : ""}
                </span>
                <span className="public-card-sub">
                  {formatDateRange(entry.startsOn, entry.endsOn)}
                </span>
                <Badge tone={entry.open ? "success" : "neutral"}>
                  {entry.open ? "Registration open" : "Registration closed"}
                </Badge>
              </Card>
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
    </main>
  );
}
