import { publicSeasonReviewsBySlug } from "../../server/reviews/season";
import { SeasonReviewItem, SeasonReviewSummary } from "./season-reviews-list";
import styles from "./season-reviews.module.css";

/**
 * The public page's reviews section (FR-1 Phase 4). ABSENT — not empty — until
 * a public season has at least three published reviews: "no reviews yet" on a
 * season nobody was asked about reads as a verdict, and fewer than three
 * unnamed reviews on a small season are not anonymous.
 */
export async function PublicSeasonReviews({ slug, orgName }: { slug: string; orgName: string }) {
  const shown = await publicSeasonReviewsBySlug(slug);
  if (shown === null) {
    return null;
  }
  return (
    <section
      className="public-section"
      aria-labelledby="reviews-heading"
      data-testid="public-reviews"
    >
      <h2 id="reviews-heading">What players and owners said</h2>
      <SeasonReviewSummary shown={shown} />
      <ul className={styles["list"]}>
        {shown.reviews.map((review) => (
          <SeasonReviewItem key={review.id} review={review} orgName={orgName} canReport />
        ))}
      </ul>
      <p className="public-hint">
        Reviews come from people who played or bid in this season, asked by DesiAuction after it
        finished, and are read by our team before they appear. The club can reply but cannot edit or
        remove them.
      </p>
    </section>
  );
}
