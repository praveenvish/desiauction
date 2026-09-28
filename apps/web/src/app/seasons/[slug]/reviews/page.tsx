import { IconMessageCircle, IconStar, SectionCard, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { seasonReviewsView } from "../../../../server/reviews/season-actions";
import { AskReviewsCard, ReplyControl } from "./season-reviews-panel";
import { ReviewCard, Stars } from "./review-card";
import "../../seasons.css";
import "../_tabs/tabs.css";
import "./reviews.css";

export const metadata = { title: "Reviews · DesiAuction" };

/**
 * A SEASON'S REVIEWS, IN THE CONSOLE (FR-1 Phase 4).
 *
 * Everybody who can open the season sees what the public sees — the same list,
 * the same three-review floor. The club's owners also see every published
 * review regardless of the floor (they are the ones who may answer it), the
 * reply control under each, and the card that asks players and owners.
 */
export default async function SeasonReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await seasonReviewsView(slug);
  if (view === null) {
    notFound();
  }
  const shown = view.shown !== null && view.shown.count > 0 ? view.shown : null;
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          {/* The result, once there is one: the average, its stars, how many.
              The four stat tiles (average, count, asked, being read) folded
              into it and into the ask card below. */}
          {shown !== null ? (
            <section className="rv-result" aria-labelledby="rv-result-title">
              <span className="rv-eyebrow">What players and owners said</span>
              <p className="rv-summary" data-testid="season-review-summary">
                {shown.average === null ? null : (
                  <>
                    <strong id="rv-result-title" className="rv-average">
                      {shown.average.toFixed(1)}
                      <span className="st-sr"> out of 5</span>
                    </strong>
                    {/* Rounded stars beside the exact number would read "4.7,
                        5 out of 5" to a screen reader; the number is the
                        statement. */}
                    <Stars rating={Math.round(shown.average)} decorative />
                  </>
                )}
                <span className="rv-result-count">
                  from {shown.count} {shown.count === 1 ? "review" : "reviews"}
                </span>
              </p>
              {view.canManage && shown.count < view.publicThreshold ? (
                <p className="st-note" data-testid="season-reviews-below-floor">
                  Only you can see these for now — the public page shows reviews once there are at
                  least {view.publicThreshold}.
                </p>
              ) : null}
            </section>
          ) : null}

          {view.manage !== null ? (
            <AskReviewsCard slug={slug} manage={view.manage} isPublic={view.isPublic} />
          ) : null}

          {shown === null ? (
            // One line: the ask card above already says who can be asked.
            <p className="rv-empty" data-testid="season-reviews">
              <IconStar size={18} aria-hidden />
              <span>
                <strong>No reviews yet.</strong>{" "}
                {view.canManage
                  ? `They appear here once DesiAuction has read them; the public page shows them from the ${ordinal(view.publicThreshold)}.`
                  : `Reviews appear once at least ${String(view.publicThreshold)} have been published.`}
              </span>
            </p>
          ) : (
            <SectionCard
              icon={<IconMessageCircle />}
              concept="neutral"
              title="Reviews"
              description={`Newest first${view.isPublic && shown.count >= view.publicThreshold ? " · shown on your public page" : ""}`}
              data-testid="season-reviews"
            >
              <ul className="rv-list">
                {shown.reviews.map((review) => (
                  <ReviewCard key={review.id} review={review} orgName={view.orgName}>
                    {view.canManage ? (
                      <ReplyControl slug={slug} reviewId={review.id} current={review.reply} />
                    ) : null}
                  </ReviewCard>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>
      </main>
    </ToastProvider>
  );
}

function ordinal(n: number): string {
  return n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `${String(n)}th`;
}
