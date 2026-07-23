import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { settlementConsole } from "../../../../server/settlement/actions";
import { MoneyPanel } from "./money-panel";
import "../../seasons.css";
import "./money.css";

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
  const view = await settlementConsole(slug);
  if (view === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack money-stack">
          <header className="dash-head">
            <div className="competition-title-row">
              <h1>{view.competition.name}</h1>
              <span className="date-row">
                {view.case !== null ? (
                  <ButtonLink
                    href={`/seasons/${slug}/money/case/${view.case.caseId}`}
                    variant="secondary"
                    data-testid="open-case-review"
                  >
                    Case review
                  </ButtonLink>
                ) : null}
                <ButtonLink href={`/seasons/${slug}`} variant="secondary">
                  Season
                </ButtonLink>
              </span>
            </div>
            <p className="competitions-hint">
              Settlement — what was owed, what came in, what closed
            </p>
          </header>
          <MoneyPanel slug={slug} console={view} />
        </div>
      </main>
    </ToastProvider>
  );
}
