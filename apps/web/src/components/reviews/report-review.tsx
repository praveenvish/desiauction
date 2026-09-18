"use client";

import { Button, Select } from "@desiauction/ui";
import { useActionState, useState } from "react";

import { reportReviewAction, type ReportState } from "../../server/reviews/public-actions";
import styles from "./season-reviews.module.css";

/**
 * "Report this review" (FR-1 Phase 4). Collapsed to a quiet link until asked
 * for; says plainly that a report goes to people, not to a delete button.
 */
export function ReportReview({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ReportState, FormData>(reportReviewAction, {});

  if (state.done === true) {
    return (
      <p className={styles["reportDone"]} role="status">
        Thanks — our team will look at it. Nothing is removed until they have.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        className={styles["reportLink"]}
        onClick={() => {
          setOpen(true);
        }}
      >
        Report this review
      </button>
    );
  }
  return (
    <form action={action} className={styles["reportForm"]}>
      <input type="hidden" name="reviewId" value={reviewId} />
      <Select label="What's wrong with it?" name="reason" defaultValue="abusive">
        <option value="abusive">It's abusive or hateful</option>
        <option value="false">It's false or misleading</option>
        <option value="personal_info">It shares someone's personal details</option>
        <option value="spam">It's spam or an advert</option>
        <option value="other">Something else</option>
      </Select>
      <label className={styles["reportNoteLabel"]}>
        <span>Anything we should know? (optional)</span>
        <textarea name="note" rows={2} maxLength={500} className={styles["reportNote"]} />
      </label>
      {state.error !== undefined ? (
        <p className={styles["reportError"]} role="alert">
          {state.error}
        </p>
      ) : null}
      <div className={styles["reportActions"]}>
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Send report
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
