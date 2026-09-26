import {
  IconEye,
  IconMessageCircle,
  IconSend,
  IconStar,
  SectionCard,
  StatCard,
  StatGrid,
  ToastProvider,
} from "@desiauction/ui";
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
  const quiet =
    shown === null &&
    (view.manage === null || (view.manage.asked === 0 && view.manage.awaitingModeration === 0));

  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          {/* Four tiles of zeros (and a "—") took the fold of an empty
              season. They appear once there is something to count. */}
          {quiet ? null : (
            <StatGrid>
              <StatCard
                icon={<IconStar />}
                tone="gold"
                value={shown?.average !== null && shown !== null ? shown.average.toFixed(1) : "—"}
                label="Average rating"
                hint={
                  shown?.average !== null && shown !== null ? (
                    <Stars rating={Math.round(shown.average)} decorative />
                  ) : (
                    "Out of 5"
                  )
                }
              />
              <StatCard
                icon={<IconMessageCircle />}
                tone="gold"
                value={shown?.count ?? 0}
                label={shown?.count === 1 ? "Review" : "Reviews"}
                hint={view.isPublic ? "Shown on your public page" : "From players and owners"}
              />
              {view.manage !== null ? (
                <>
                  <StatCard
                    icon={<IconSend />}
                    tone="gold"
                    value={view.manage.asked}
                    label="Asked so far"
                    hint={`${String(view.manage.reviewed)} answered`}
                    {...(view.manage.asked > 0
                      ? { progress: (view.manage.reviewed / view.manage.asked) * 100 }
                      : {})}
                  />
                  <StatCard
                    icon={<IconEye />}
                    tone="gold"
                    value={view.manage.awaitingModeration}
                    label="Being read"
                    hint="By DesiAuction, before they appear"
                  />
                </>
              ) : null}
            </StatGrid>
          )}

          {view.manage !== null ? (
            <AskReviewsCard slug={slug} manage={view.manage} isPublic={view.isPublic} />
          ) : null}

          <SectionCard
            icon={<IconMessageCircle />}
            concept="neutral"
            title="What players and owners said"
            description={
              shown === null
                ? undefined
                : `${String(shown.count)} ${shown.count === 1 ? "review" : "reviews"} from players and owners`
            }
            data-testid="season-reviews"
          >
            {shown === null ? (
              <div className="st-empty">
                <span className="st-empty-glyph" aria-hidden>
                  <IconStar size={26} />
                </span>
                <h3>No reviews to show yet</h3>
                <p>
                  {view.canManage
                    ? view.manage !== null &&
                      view.manage.askable.players + view.manage.askable.owners === 0 &&
                      view.manage.asked === 0
                      ? "Reviews appear here once DesiAuction has read them. Nobody can be asked yet — a player needs an approved entry, an email and a date of birth on file."
                      : "Reviews appear here once DesiAuction has read them."
                    : `Reviews appear once at least ${String(view.publicThreshold)} have been published.`}
                </p>
              </div>
            ) : (
              <div className="rv-body">
                <p className="rv-summary" data-testid="season-review-summary">
                  {shown.average === null ? null : (
                    <>
                      <strong className="rv-average">
                        {shown.average.toFixed(1)}
                        <span className="st-sr"> out of 5</span>
                      </strong>
                      {/* Rounded stars beside the exact number would read "4.7,
                          5 out of 5" to a screen reader; the number is the
                          statement. */}
                      <Stars rating={Math.round(shown.average)} decorative />
                    </>
                  )}
                  <span className="st-note">
                    {shown.count} {shown.count === 1 ? "review" : "reviews"} from players and owners
                  </span>
                </p>
                {view.canManage && shown.count < view.publicThreshold ? (
                  <p className="st-note" data-testid="season-reviews-below-floor">
                    Only you can see these for now — the public page shows reviews once there are at
                    least {view.publicThreshold}.
                  </p>
                ) : null}
                <ul className="rv-list">
                  {shown.reviews.map((review) => (
                    <ReviewCard key={review.id} review={review} orgName={view.orgName}>
                      {view.canManage ? (
                        <ReplyControl slug={slug} reviewId={review.id} current={review.reply} />
                      ) : null}
                    </ReviewCard>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>
        </div>
      </main>
    </ToastProvider>
  );
}
