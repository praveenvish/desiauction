"use client";

import { Button, IconLock, IconSend, SectionCard, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  askSeasonReviewsAction,
  replyToReviewAction,
  type SeasonReviewsView,
} from "../../../../server/reviews/season-actions";
import { formatShortDate } from "../../../../lib/format-date";

/**
 * The club's two controls (FR-1 Phase 4): ask for reviews, and answer one.
 *
 * The ask card says who would be asked BEFORE the press — how many players,
 * how many owners — and says who is left out and why, so "only 12 of my 40
 * players?" has its answer on the card rather than in a support email.
 */

function day(date: Date): string {
  return formatShortDate(date);
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
    <SectionCard
      icon={<IconSend />}
      concept="season"
      title="Ask for reviews"
      description={`We email your players and team owners a link to review this season. What they write is read by DesiAuction before it appears${isPublic ? " on your public season page" : ""}; you can reply, but not edit or remove it.`}
      action={
        <Button
          loading={pending}
          // A disabled PRIMARY read as a pale gold call to action. When there
          // is nothing to press, the button says so in the neutral weight.
          variant={manage.nextAskAt !== null || askable === 0 ? "secondary" : "primary"}
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
          {manage.nextAskAt !== null || askable === 0 ? (
            <IconLock size={16} aria-hidden />
          ) : (
            <IconSend size={16} aria-hidden />
          )}
          {askable === 0 ? "Nobody left to ask" : `Ask ${String(askable)}`}
        </Button>
      }
      data-testid="season-reviews-ask"
    >
      {/* One line in one size — the grey slab mixed a label and a figure. */}
      <p className="rv-ask-line">
        <strong>Could be asked now:</strong> {manage.askable.players}{" "}
        {manage.askable.players === 1 ? "player" : "players"}, {manage.askable.owners}{" "}
        {manage.askable.owners === 1 ? "owner" : "owners"}
      </p>
      <details className="rv-who">
        <summary>Who is asked?</summary>
        <p className="st-note rv-ask-note">
          Players are asked only if they&apos;re approved, have an email on file, and gave a date of
          birth showing they&apos;re 18 or over. Anyone who has turned off feedback requests is
          skipped.
        </p>
      </details>
      {manage.nextAskAt !== null ? (
        <p className="st-note rv-ask-note" data-testid="season-reviews-next-ask">
          You asked on {day(manage.lastAskedAt ?? manage.nextAskAt)}. You can ask again from{" "}
          {day(manage.nextAskAt)}.
        </p>
      ) : null}
    </SectionCard>
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
      <div className="rv-reply-open">
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
      className="rv-reply-form"
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
      <label htmlFor={id} className="rv-reply-label">
        Your reply, shown under the review
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={1000}
        value={text}
        className="rv-reply-input"
        onChange={(event) => {
          setText(event.currentTarget.value);
        }}
      />
      <div className="rv-reply-actions">
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
