import {
  AnnouncerProvider,
  ButtonLink,
  EmptyState,
  IconFileCheck,
  ToastProvider,
} from "@desiauction/ui";
import { notFound } from "next/navigation";

import { currentSession } from "../../../../server/auth/actions";
import { resolveMemberCompetition } from "../../../../server/competition/resolve";
import { seasonUnit } from "../../../../server/competition/season-unit";
import { settlementConsole } from "../../../../server/settlement/actions";
import { SquadsBySpend, spendNightOf } from "../../../../components/team/squads-by-spend";
import { MoneyPanel } from "./money-panel";
import "../../seasons.css";
import "../_tabs/tabs.css";
import "./money.css";
import "./season-money.css";

export const metadata = { title: "Money · DesiAuction" };

/**
 * PX-7 E1 — the Settlement console.
 *
 * `settlementConsole` returns null for a non-member AND for a member without
 * `settlement.view`: the books are not "locked" to someone who lacks the grant,
 * they are absent. notFound() is therefore the correct response to both — the
 * screen never confirms that money it may not see exists.
 */
export default async function MoneyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [view, unit, session] = await Promise.all([
    settlementConsole(slug),
    seasonUnit(slug),
    currentSession(),
  ]);
  // A points season has no books to keep private, so a MEMBER without the
  // money grant is told what the season ran on — in the console, as /money
  // says it — instead of being dropped onto the marketing 404. Everyone else
  // (and every rupee season without the grant) still gets the 404: existence
  // privacy is about the books, and a points season has none.
  const pointsMember =
    unit === "points" &&
    view === null &&
    session !== null &&
    (await resolveMemberCompetition(session.personId, slug)) !== null;
  if (view === null && !pointsMember) {
    notFound();
  }
  if (unit === "points") {
    // A points season (0091) never has books: the tab is gone from its strip
    // and every settlement command refuses. An old link or a bookmark lands
    // here and is told why, rather than shown an empty console that invites
    // opening a case.
    /* The points summary /money already draws (round 5A): what each team
       spent of its purse. It replaces the lone "See the squads" button — the
       block carries the same door. */
    const night = await spendNightOf(slug, "This season");
    return (
      <main className="registrations-dash">
        <div className="dash-stack money-stack">
          <EmptyState
            headingLevel={2}
            size={night !== null ? "compact" : "default"}
            title="Nothing to settle"
            description="This is a points season — the purses and prices are points, and no money changes hands. Registration fees, if any, are kept on the Players tab."
            {...(night === null
              ? {
                  action: (
                    <ButtonLink href={`/seasons/${slug}/teams`} variant="secondary" size="sm">
                      See the squads
                    </ButtonLink>
                  ),
                }
              : {})}
            data-testid="points-no-settlement"
          />
          {night !== null ? (
            <SquadsBySpend
              night={night}
              testId="season-money-spend"
              description="The points each team spent of its purse, and its top buy"
            />
          ) : null}
        </div>
      </main>
    );
  }
  if (view === null) {
    notFound();
  }
  return (
    /* The toast region is polite by design and queues. A REFUSED money command
       needs the assertive channel, which lives on the announcer. */
    <ToastProvider>
      <AnnouncerProvider>
        <main className="registrations-dash">
          <div className="dash-stack money-stack">
            <div className="st-head">
              <p className="st-head-lede">Settlement — what was owed, what came in, what closed.</p>
              {view.case !== null ? (
                <div className="st-actions">
                  <ButtonLink
                    href={`/seasons/${slug}/money/case/${view.case.caseId}`}
                    variant="secondary"
                    size="sm"
                    data-testid="open-case-review"
                  >
                    <IconFileCheck size={16} aria-hidden />
                    Case review
                  </ButtonLink>
                </div>
              ) : null}
            </div>
            <MoneyPanel slug={slug} console={view} />
          </div>
        </main>
      </AnnouncerProvider>
    </ToastProvider>
  );
}
