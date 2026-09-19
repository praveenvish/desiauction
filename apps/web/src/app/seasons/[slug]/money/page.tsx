import { AnnouncerProvider, ButtonLink, IconFileCheck, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

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
  const view = await settlementConsole(slug);
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
