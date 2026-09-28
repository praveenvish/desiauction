"use client";

import { Button, IconArrowRight, IconLock, IconSend, useToast } from "@desiauction/ui";
import Link from "next/link";
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

const REASONS: readonly {
  key: "noEmail" | "ageRule" | "alreadyAsked" | "runsSeason";
  say: (n: number, role: "player" | "owner") => string;
}[] = [
  { key: "noEmail", say: (n) => `${String(n)} ${n === 1 ? "has" : "have"} no email on file` },
  {
    key: "ageRule",
    say: (n, role) =>
      role === "player"
        ? `${String(n)} ${n === 1 ? "has" : "have"} no date of birth, or ${n === 1 ? "is" : "are"} under 18`
        : `${String(n)} ${n === 1 ? "is" : "are"} under 18`,
  },
  { key: "alreadyAsked", say: (n) => `${String(n)} already asked` },
  { key: "runsSeason", say: (n) => `${String(n)} ${n === 1 ? "runs" : "run"} the season` },
];

/**
 * ASK FOR REVIEWS, AND WHO CANNOT BE ASKED (redesign 2026-09-28).
 *
 * The card said "Could be asked now: 0 players, 0 owners" on a season of 43
 * approved players and 3 owners, and a second card listed three reasons that
 * MIGHT apply. The one that did — nobody had an email, and asks go by email —
 * was never said. Each group now shows how many took part, how many can be
 * asked, and why the rest cannot, with the door to fix it.
 */
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
  const { players, owners } = manage.breakdown;
  const tookPart = players.total + owners.total;
  const blocked = manage.nextAskAt !== null || askable === 0;
  const onlyEmail =
    askable === 0 &&
    tookPart > 0 &&
    players.noEmail + owners.noEmail ===
      tookPart -
        players.alreadyAsked -
        owners.alreadyAsked -
        players.runsSeason -
        owners.runsSeason;

  const someAsked = players.alreadyAsked + owners.alreadyAsked > 0;
  const title =
    tookPart === 0
      ? "Nobody has taken part yet"
      : askable > 0
        ? `${String(askable)} ${askable === 1 ? "person" : "people"} can be asked`
        : someAsked
          ? "Nobody else can be asked"
          : "Nobody can be asked yet";
  const sub =
    tookPart === 0
      ? "Approved players and team owners can be asked once the season has them."
      : onlyEmail
        ? someAsked
          ? "Reviews are asked for by email, and everyone not yet asked has none on file."
          : "Reviews are asked for by email, and nobody here has one on file."
        : askable === 0
          ? "Each group below says why."
          : `We email them a link to review this season. DesiAuction reads each review before it appears${isPublic ? " on your public page" : ""}; you can reply, but not edit or remove it.`;

  const groups = [
    { role: "player" as const, label: "players", one: "player", bucket: players },
    { role: "owner" as const, label: "team owners", one: "team owner", bucket: owners },
  ].filter((group) => group.bucket.total > 0);

  return (
    <section
      className="rv-ask"
      data-state={askable > 0 && manage.nextAskAt === null ? "ready" : "blocked"}
      aria-labelledby="rv-ask-title"
      data-testid="season-reviews-ask"
    >
      <div className="rv-ask-head">
        <div className="rv-ask-text">
          <span className="rv-eyebrow">Ask for reviews</span>
          <h2 id="rv-ask-title" className="rv-ask-title">
            {title}
          </h2>
          <p className="rv-ask-sub">{sub}</p>
        </div>
        <Button
          size="touch"
          loading={pending}
          // A disabled PRIMARY read as a pale gold call to action. When there
          // is nothing to press, the button says so in the neutral weight.
          variant={blocked ? "secondary" : "primary"}
          disabled={blocked}
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
          {blocked ? <IconLock size={16} aria-hidden /> : <IconSend size={16} aria-hidden />}
          {askable === 0 ? "Nobody to ask yet" : `Ask ${String(askable)}`}
        </Button>
      </div>

      {groups.length > 0 ? (
        <ul className="rv-groups" data-testid="season-reviews-breakdown">
          {groups.map((group) => {
            const reasons = REASONS.filter((reason) => group.bucket[reason.key] > 0);
            return (
              <li key={group.role}>
                <span className="rv-group-head">
                  <strong>
                    {group.bucket.total} {group.bucket.total === 1 ? group.one : group.label}
                  </strong>
                  <span>{group.bucket.askable} can be asked</span>
                </span>
                <span className="rv-meter" aria-hidden>
                  <span
                    style={{
                      width: `${String(Math.round((group.bucket.askable / group.bucket.total) * 100))}%`,
                    }}
                  />
                </span>
                {reasons.length > 0 ? (
                  <span className="rv-group-why">
                    {reasons
                      .map((reason) => reason.say(group.bucket[reason.key], group.role))
                      .join(" · ")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {manage.asked > 0 ? (
        <dl className="rv-asked">
          <div>
            <dt>asked</dt>
            <dd>{manage.asked}</dd>
          </div>
          <div>
            <dt>answered</dt>
            <dd>{manage.reviewed}</dd>
          </div>
          <div>
            <dt>being read by DesiAuction</dt>
            <dd>{manage.awaitingModeration}</dd>
          </div>
        </dl>
      ) : null}

      <p className="rv-ask-foot">
        {manage.nextAskAt !== null ? (
          <span data-testid="season-reviews-next-ask">
            You asked on {day(manage.lastAskedAt ?? manage.nextAskAt)}. You can ask again from{" "}
            {day(manage.nextAskAt)}.{" "}
          </span>
        ) : null}
        Players need an approved entry, an email and a date of birth showing they are 18 or over;
        anyone who turned feedback requests off is skipped.{" "}
        {players.noEmail + players.ageRule > 0 ? (
          <Link href={`/seasons/${slug}/registrations`} className="rv-ask-door">
            Open Players
            <IconArrowRight size={14} aria-hidden />
          </Link>
        ) : null}
      </p>
    </section>
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
