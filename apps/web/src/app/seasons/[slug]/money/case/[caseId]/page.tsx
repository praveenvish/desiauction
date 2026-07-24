import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { caseReview } from "../../../../../../server/settlement/actions";
import { caseTabFrom } from "../../../../../../server/settlement/worklist";
import { CasePanel } from "./case-panel";
import "../../../../seasons.css";
import "../../money.css";

export const metadata = { title: "Case review · DesiAuction" };

/**
 * PX-7 E2 — Case review.
 *
 * `?tab=` is honoured so a case can be linked at the section that matters —
 * "look at the evidence" is a URL, not a set of instructions.
 */
export default async function CaseReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; caseId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ slug, caseId }, query] = await Promise.all([params, searchParams]);
  const review = await caseReview(slug, caseId);
  if (review === null) {
    notFound();
  }
  const initialTab = caseTabFrom(query.tab);
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack money-stack">
          <header className="dash-head">
            {/* Title and trail are the shell's — a second copy of either here
                would be a duplicate landmark, which axe rightly refuses. */}
            <div className="competition-title-row title-row-actions">
              <span className="date-row">
                <ButtonLink href={`/seasons/${slug}/money`} variant="secondary">
                  Back to settlement
                </ButtonLink>
              </span>
            </div>
            <p className="competitions-hint">
              Everything this case did, folded from the log it cannot rewrite
            </p>
          </header>
          <CasePanel slug={slug} review={review} initialTab={initialTab} />
        </div>
      </main>
    </ToastProvider>
  );
}
