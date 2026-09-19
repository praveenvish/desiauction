import { IconStar, IconStarOutline, IconUser, Pill } from "@desiauction/ui";
import type { ReactNode } from "react";

import type { PublishedReview } from "../../../../server/reviews/season";

/**
 * One published review, as the console shows it: who (only as far as they
 * chose to be named), how many stars, what they wrote, and the club's reply.
 * Every word below the byline was written by somebody outside the club and
 * renders as text only.
 */

const ROLE_WORDS: Record<string, string> = {
  owner: "A team owner",
  player: "A player",
};

export function Stars({ rating, decorative = false }: { rating: number; decorative?: boolean }) {
  return (
    <span className="rv-stars">
      {decorative ? null : <span className="st-sr">{`${String(rating)} out of 5`}</span>}
      <span aria-hidden="true" className="rv-stars-row">
        {[1, 2, 3, 4, 5].map((n) =>
          n <= rating ? (
            <IconStar key={n} size={16} className="rv-star-on" />
          ) : (
            <IconStarOutline key={n} size={16} className="rv-star-off" />
          ),
        )}
      </span>
    </span>
  );
}

function when(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

export function ReviewCard({
  review,
  orgName,
  children,
}: {
  review: PublishedReview;
  orgName: string;
  children?: ReactNode;
}) {
  const who =
    review.signedName !== null ? review.signedName : (ROLE_WORDS[review.role] ?? "A participant");
  return (
    <li className="rv-card" data-testid={`season-review-${review.id}`}>
      <div className="rv-head">
        <span className="rv-avatar" data-named={review.signedName !== null} aria-hidden>
          {review.signedName !== null ? initials(review.signedName) : <IconUser size={18} />}
        </span>
        <span className="rv-who">
          <strong>{who}</strong>
          <span className="st-sub">
            {review.signedName !== null ? (
              <Pill tone={review.role === "owner" ? "purple" : "blue"}>
                {review.role === "owner" ? "Team owner" : "Player"}
              </Pill>
            ) : null}{" "}
            {when(review.createdAt)}
          </span>
        </span>
        <Stars rating={review.rating} />
      </div>
      {review.text !== null ? <p className="rv-text">{review.text}</p> : null}
      {review.reply !== null ? (
        <div className="rv-reply">
          <p className="rv-reply-by">Reply from {orgName}</p>
          <p className="rv-text">{review.reply}</p>
        </div>
      ) : null}
      {children}
    </li>
  );
}
