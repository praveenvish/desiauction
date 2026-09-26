import {
  IconCalendar,
  IconChevronRight,
  ListRow,
  SectionCard,
  ToastProvider,
} from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { venuesView } from "../../../../server/competition/fixture-actions";
import { orgCatalogue } from "../../../../server/orgs/catalogue";
import { dateRange } from "../../../tournaments/season-card";
import { VenuesPanel } from "./venues-panel";
import "../../../seasons/seasons.css";
import "./venues.css";

export const metadata = { title: "Venues · DesiAuction" };

export default async function VenuesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [view, catalogue] = await Promise.all([venuesView(slug), orgCatalogue(slug)]);
  // Non-members and unknown slugs are indistinguishable (tenancy, IP-2 pattern),
  // and so is a member with no `venue.manage`: this page is a management desk,
  // and it returned 200 to a plain viewer while /money and /settlement — the
  // same shape of desk — correctly returned 404. Absent, not locked.
  if (view === null || !view.viewer.canManage) {
    notFound();
  }
  const seasons = [
    ...(catalogue?.tournaments.flatMap((tournament) => tournament.editions) ?? []),
    ...(catalogue?.standalone ?? []),
  ]
    .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""))
    .slice(0, 5);
  const hasGrounds = view.venues.some((venue) => venue.grounds.length > 0);
  return (
    <ToastProvider>
      <main className="competitions">
        <div className="competitions-stack">
          <header className="dash-head">
            <p className="competitions-hint" data-testid="venues-heading">
              Grounds and when they&apos;re free — matches are scheduled onto them.
            </p>
          </header>
          <VenuesPanel slug={slug} venues={view.venues} canManage={view.viewer.canManage} />
          {/* The next object (round 5A): the seasons these grounds serve, and
              what each is waiting on — the form alone left a blank page, and
              "why am I adding a venue" had no answer on it. */}
          {seasons.length > 0 ? (
            <SectionCard
              icon={<IconCalendar />}
              concept="fixtures"
              title="Seasons that play here"
              description={
                hasGrounds
                  ? "Their fixtures are scheduled onto these grounds"
                  : "Fixtures and lineups wait on a ground — add one above"
              }
              flush
              data-testid="venues-seasons"
            >
              <ul className="vn-seasons">
                {seasons.map((season) => (
                  <li key={season.id}>
                    <ListRow
                      href={`/seasons/${season.slug}/fixtures`}
                      linkComponent={Link}
                      title={season.name}
                      meta={[
                        dateRange(season.startsOn, season.endsOn),
                        season.location,
                        season.matches > 0
                          ? `${String(season.matches)} ${season.matches === 1 ? "match" : "matches"} scheduled`
                          : "No matches yet",
                      ]
                        .filter((part): part is string => part !== null && part !== "")
                        .join(" · ")}
                      figure={<IconChevronRight size={16} aria-hidden />}
                    />
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>
      </main>
    </ToastProvider>
  );
}
