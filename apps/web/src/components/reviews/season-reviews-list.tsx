import { StarGlyphs } from "@desiauction/ui";

import type { PublishedReview, SeasonReviews } from "../../server/reviews/season";
import { ReportReview } from "./report-review";
import styles from "./season-reviews.module.css";
import { formatMonthYear } from "../../lib/format-date";

/**
 * A SEASON'S PUBLISHED REVIEWS (FR-1 Phase 4) — shared by the public season page
 * and the organizer's Reviews tab, so the club sees exactly what the public
 * sees, plus its own controls.
 *
 * Every word below the heading was written by somebody outside the club and
 * renders as text only. An unnamed review is signed with the part the person
 * had — "A team owner" — which is true, useful, and not a name.
 */

const ROLE_WORDS: Record<string, string> = {
  owner: "A team owner",
  player: "A player",
};

function Stars({ rating, decorative = false }: { rating: number; decorative?: boolean }) {
  return (
    <span className={styles["stars"]}>
      {decorative ? null : <span className={styles["srOnly"]}>{`${String(rating)} out of 5`}</span>}
      <StarGlyphs rating={rating} />
    </span>
  );
}

function when(date: Date): string {
  return formatMonthYear(date);
}

export function SeasonReviewSummary({ shown }: { shown: SeasonReviews }) {
  return (
    <p className={styles["summary"]} data-testid="season-review-summary">
      {shown.average === null ? null : (
        <>
          <strong className={styles["average"]}>
            {shown.average.toFixed(1)}
            <span className={styles["srOnly"]}> out of 5</span>
          </strong>
          {/* Rounded stars beside the exact number would read "4.7, 5 out of
              5" to a screen reader; the number is the statement. */}
          <Stars rating={Math.round(shown.average)} decorative />
        </>
      )}
      <span className={styles["count"]}>
        {shown.count} {shown.count === 1 ? "review" : "reviews"} from players and owners
      </span>
    </p>
  );
}

export function SeasonReviewItem({
  review,
  orgName,
  canReport,
  children,
}: {
  review: PublishedReview;
  orgName: string;
  canReport: boolean;
  /** The organizer's reply controls, when the viewer may reply. */
  children?: React.ReactNode;
}) {
  return (
    <li className={styles["review"]} data-testid={`season-review-${review.id}`}>
      <div className={styles["head"]}>
        <Stars rating={review.rating} />
        <span className={styles["byline"]}>
          {review.signedName !== null
            ? `${review.signedName} · ${review.role === "owner" ? "team owner" : "player"}`
            : (ROLE_WORDS[review.role] ?? "A participant")}
          {" · "}
          {when(review.createdAt)}
        </span>
      </div>
      {review.text !== null ? <p className={styles["text"]}>{review.text}</p> : null}
      {review.reply !== null ? (
        <div className={styles["reply"]}>
          <p className={styles["replyBy"]}>Reply from {orgName}</p>
          <p className={styles["text"]}>{review.reply}</p>
        </div>
      ) : null}
      {children}
      {canReport ? <ReportReview reviewId={review.id} /> : null}
    </li>
  );
}
