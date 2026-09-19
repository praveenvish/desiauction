import { Card, EmptyState, PageIntro, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import {
  SeasonReviewItem,
  SeasonReviewSummary,
} from "../../../../components/reviews/season-reviews-list";
import { seasonReviewsView } from "../../../../server/reviews/season-actions";
import { AskReviewsCard, ReplyControl } from "./season-reviews-panel";
import "../../seasons.css";
import listStyles from "../../../../components/reviews/season-reviews.module.css";

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

  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <PageIntro />
          {view.manage !== null ? (
            <AskReviewsCard slug={slug} manage={view.manage} isPublic={view.isPublic} />
          ) : null}
          <Card data-testid="season-reviews">
            <h2>What players and owners said</h2>
            {view.shown === null || view.shown.count === 0 ? (
              <EmptyState
                headingLevel={3}
                title="No reviews to show yet"
                description={
                  view.canManage
                    ? "Reviews appear here once our team has read them. Ask your players and owners above once the season is done."
                    : `Reviews appear once at least ${String(view.publicThreshold)} have been published.`
                }
              />
            ) : (
              <>
                <SeasonReviewSummary shown={view.shown} />
                {view.canManage && view.shown.count < view.publicThreshold ? (
                  <p className="competitions-hint" data-testid="season-reviews-below-floor">
                    Only you can see these for now — the public page shows reviews once there are at
                    least {view.publicThreshold}.
                  </p>
                ) : null}
                <ul className={listStyles["list"]}>
                  {view.shown.reviews.map((review) => (
                    <SeasonReviewItem
                      key={review.id}
                      review={review}
                      orgName={view.orgName}
                      canReport={false}
                    >
                      {view.canManage ? (
                        <ReplyControl slug={slug} reviewId={review.id} current={review.reply} />
                      ) : null}
                    </SeasonReviewItem>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      </main>
    </ToastProvider>
  );
}
