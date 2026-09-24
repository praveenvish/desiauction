import {
  AnnouncerProvider,
  ButtonLink,
  EmptyState,
  IconFileCheck,
  ToastProvider,
} from "@desiauction/ui";
import { notFound } from "next/navigation";

import { seasonUnit } from "../../../../server/competition/season-unit";
import { settlementConsole } from "../../../../server/settlement/actions";
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
  const [view, unit] = await Promise.all([settlementConsole(slug), seasonUnit(slug)]);
  if (view === null) {
    notFound();
  }
  if (unit === "points") {
    // A points season (0091) never has books: the tab is gone from its strip
    // and every settlement command refuses. An old link or a bookmark lands
    // here and is told why, rather than shown an empty console that invites
    // opening a case.
    return (
      <main className="registrations-dash">
        <div className="dash-stack money-stack">
          <EmptyState
            headingLevel={2}
            title="Nothing to settle"
            description="This is a points season — the purses and prices are points, and no money changes hands. Registration fees, if any, are kept on the Players tab."
            action={
              <ButtonLink href={`/seasons/${slug}/teams`} variant="secondary" size="sm">
                See the squads
              </ButtonLink>
            }
            data-testid="points-no-settlement"
          />
        </div>
      </main>
    );
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
