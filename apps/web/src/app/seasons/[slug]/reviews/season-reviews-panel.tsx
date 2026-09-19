"use client";

import { Button, Card, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  askSeasonReviewsAction,
  replyToReviewAction,
  type SeasonReviewsView,
} from "../../../../server/reviews/season-actions";

/**
 * The club's two controls (FR-1 Phase 4): ask for reviews, and answer one.
 *
 * The ask card says who would be asked BEFORE the press — how many players,
 * how many owners — and says who is left out and why, so "only 12 of my 40
 * players?" has its answer on the card rather than in a support email.
 */

function day(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function AskReviewsCard({
  slug,
  manage,
  isPublic,
}: {
  slug: string;
  manage: NonNullable<SeasonReviewsView["manage"]>;
  isPublic: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const askable = manage.askable.players + manage.askable.owners;

  return (
    <Card data-testid="season-reviews-ask">
      <h2>Ask for reviews</h2>
      <p className="competitions-hint">
        We email your players and team owners a link to review this season. What they write is read
        by DesiAuction before it appears{isPublic ? " on your public season page" : ""}; you can
        reply, but not edit or remove it.
      </p>
      <dl className="season-reviews-stats">
        <div>
          <dt>Could be asked now</dt>
          <dd>
            {manage.askable.players} {manage.askable.players === 1 ? "player" : "players"},{" "}
            {manage.askable.owners} {manage.askable.owners === 1 ? "owner" : "owners"}
          </dd>
        </div>
        <div>
          <dt>Asked so far</dt>
          <dd>{manage.asked}</dd>
        </div>
        <div>
          <dt>Reviewed</dt>
          <dd>
            {manage.reviewed}
            {manage.awaitingModeration > 0
              ? ` (${String(manage.awaitingModeration)} being read)`
              : ""}
          </dd>
        </div>
      </dl>
      <p className="competitions-hint">
        Players are asked only if they&apos;re approved, have an email on file, and gave a date of
        birth showing they&apos;re 18 or over. Anyone who has turned off feedback requests is
        skipped.
      </p>
      <div>
        <Button
          loading={pending}
          disabled={manage.nextAskAt !== null || askable === 0}
          onClick={() => {
            start(async () => {
              const result = await askSeasonReviewsAction(slug);
              toast({
                title: result.ok ? result.summary : result.error,
                tone: result.ok ? "success" : "danger",
              });
              router.refresh();
            });
          }}
          data-testid="season-reviews-ask-button"
        >
          {askable === 0 ? "Nobody left to ask" : `Ask ${String(askable)}`}
        </Button>
      </div>
      {manage.nextAskAt !== null ? (
        <p className="competitions-hint" data-testid="season-reviews-next-ask">
          You asked on {day(manage.lastAskedAt ?? manage.nextAskAt)}. You can ask again from{" "}
          {day(manage.nextAskAt)}.
        </p>
      ) : null}
    </Card>
  );
}

export function ReplyControl({
  slug,
  reviewId,
  current,
}: {
  slug: string;
  reviewId: string;
  current: string | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(current ?? "");
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(true);
          }}
        >
          {current === null ? "Reply" : "Edit reply"}
        </Button>
      </div>
    );
  }

  const id = `reply-${reviewId}`;
  return (
    <form
      className="season-reviews-reply"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await replyToReviewAction(slug, reviewId, text);
          if (!result.ok) {
            toast({ title: result.error, tone: "danger" });
            return;
          }
          toast({ title: result.summary, tone: "success" });
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <label htmlFor={id} className="season-reviews-reply-label">
        Your reply, shown under the review
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={1000}
        value={text}
        className="season-reviews-reply-input"
        onChange={(event) => {
          setText(event.currentTarget.value);
        }}
      />
      <div className="season-reviews-reply-actions">
        <Button type="submit" size="sm" loading={pending}>
          {text.trim() === "" && current !== null ? "Remove reply" : "Post reply"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setText(current ?? "");
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
