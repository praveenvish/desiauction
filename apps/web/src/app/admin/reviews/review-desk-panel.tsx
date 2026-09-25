"use client";

import {
  Button,
  Field,
  IconEyeOff,
  IconGlobe,
  IconMail,
  IconSend,
  IconStar,
  Pill,
  SectionCard,
  StarGlyphs,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  askForReviewAction,
  dismissReportsAction,
  moderateReviewAction,
} from "../../../server/admin/review-actions";
import type { DeskAsk, DeskReview, ReviewDesk } from "../../../server/admin/review-views";
import type { AskOutcome } from "../../../server/reviews/desk";
import { AdminEmpty } from "../admin-ui";

/**
 * ASK, THEN MODERATE (FR-1 Phase 2).
 *
 * The ask always yields a link, even when mail cannot go — most organizers here
 * live on WhatsApp, and "copy the link and send it yourself" is a real path, not
 * a fallback to apologise for. The desk says plainly which of those happened.
 *
 * Review text is a stranger's words rendered in an operator's console: text
 * nodes only, wrapped so an unbroken string cannot widen the page.
 */

const DELIVERY_WORDS: Record<Extract<AskOutcome, { ok: true }>["delivery"], string> = {
  sent: "Emailed.",
  "no-address": "They have no email on file — copy the link and send it yourself.",
  "opted-out": "They've switched off feedback requests, so we didn't email. Don't send the link.",
  "mail-unconfigured": "Email isn't configured here — copy the link and send it yourself.",
  "mail-failed": "The email didn't go through — copy the link and send it yourself.",
  "skipped-already-reviewed": "They've already reviewed us, so we didn't ask again.",
};

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ReviewDeskPanel({ desk }: { desk: ReviewDesk }) {
  return (
    <>
      <AskCard />
      <SectionCard
        icon={<IconStar />}
        tone="amber"
        title="Waiting for a decision"
        description={
          desk.pending.length === 0
            ? "Publish the ones worth standing behind; hide the rest"
            : `${String(desk.pending.length)} to publish or hide`
        }
        flush
        data-testid="review-desk-pending"
      >
        {desk.pending.length === 0 ? (
          <AdminEmpty icon={<IconStar size={24} weight="duotone" />} title="Nothing waiting">
            New reviews land here as people send them.
          </AdminEmpty>
        ) : (
          <ul className="admin-rows is-stacked">
            {desk.pending.map((review) => (
              <ReviewRow key={review.id} review={review} />
            ))}
          </ul>
        )}
      </SectionCard>
      {desk.published.length > 0 ? (
        <SectionCard
          icon={<IconGlobe />}
          tone="green"
          title="Published"
          description={`${String(desk.published.length)} live`}
          flush
          data-testid="review-desk-published"
        >
          <ul className="admin-rows is-stacked">
            {desk.published.map((review) => (
              <ReviewRow key={review.id} review={review} />
            ))}
          </ul>
        </SectionCard>
      ) : null}
      {desk.hidden.length > 0 ? (
        <SectionCard
          icon={<IconEyeOff />}
          tone="neutral"
          title="Hidden"
          description={`${String(desk.hidden.length)} kept off every page`}
          flush
          data-testid="review-desk-hidden"
        >
          <ul className="admin-rows is-stacked">
            {desk.hidden.map((review) => (
              <ReviewRow key={review.id} review={review} />
            ))}
          </ul>
        </SectionCard>
      ) : null}
      {desk.asks.length > 0 ? <AsksCard asks={desk.asks} /> : null}
    </>
  );
}

function AskCard() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AskOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  return (
    <SectionCard
      icon={<IconSend />}
      title="Ask for a review"
      description="Ask somebody who ran a tournament how it went. You always get a link to send yourself."
      data-testid="review-desk-ask"
    >
      <form
        className="review-ask"
        onSubmit={(event) => {
          event.preventDefault();
          setCopied(false);
          start(async () => {
            const outcome = await askForReviewAction(query);
            setResult(outcome);
            if (outcome.ok) {
              router.refresh();
            }
          });
        }}
      >
        <Field
          label="Their email or mobile number"
          name="contact"
          value={query}
          required
          autoComplete="off"
          help="They must have signed in to DesiAuction at least once."
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          {...(result !== null && !result.ok ? { error: result.error } : {})}
        />
        <div>
          <Button type="submit" loading={pending}>
            Ask
          </Button>
        </div>
      </form>
      {result !== null && result.ok ? (
        <div className="review-ask-result" role="status" data-testid="review-ask-result">
          <p>
            {result.personName ?? "They"} {result.created ? "were asked" : "had already been asked"}
            . {DELIVERY_WORDS[result.delivery]}
          </p>
          {result.delivery !== "opted-out" && result.delivery !== "skipped-already-reviewed" ? (
            <div className="review-ask-link">
              <code>{result.link}</code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(result.link).then(() => {
                    setCopied(true);
                  });
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

const REASON_WORDS: Record<string, string> = {
  abusive: "Abusive or hateful",
  false: "False or misleading",
  personal_info: "Shares personal details",
  spam: "Spam or advert",
  other: "Something else",
};

function ReviewRow({ review }: { review: DeskReview }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();

  const move = (status: "published" | "hidden") => {
    start(async () => {
      const result = await moderateReviewAction(review.id, status);
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: result.summary, tone: "success" });
      router.refresh();
    });
  };

  return (
    <li className="review-row" id={review.id} data-testid={`review-${review.id}`}>
      <div className="review-row-head">
        <div>
          <p className="review-row-rating">
            <VisuallyHidden>{`${String(review.rating)} out of 5`}</VisuallyHidden>
            <StarGlyphs rating={review.rating} />
          </p>
          <p className="pass-row-sub">
            {review.seasonName === null
              ? "About DesiAuction"
              : `About ${review.seasonName} · ${review.role === "owner" ? "team owner" : "player"}`}
          </p>
          <p className="admin-meta">
            {review.personName ?? "No name on file"} · {day(review.createdAt)}
            {review.updatedAt.getTime() - review.createdAt.getTime() > 60_000
              ? ` · edited ${day(review.updatedAt)}`
              : ""}
          </p>
        </div>
        <span className="review-row-badges">
          {review.reports.length > 0 ? (
            <Pill tone="red" dot>
              {review.reports.length} {review.reports.length === 1 ? "report" : "reports"}
            </Pill>
          ) : null}
          <Pill tone={review.mayQuote ? "green" : "neutral"}>
            {review.seasonName === null
              ? review.mayQuote
                ? review.status === "published"
                  ? "on the home page"
                  : "may quote — publishing shows it on the home page"
                : "not for quoting"
              : review.mayQuote
                ? "signed"
                : "unsigned"}
          </Pill>
        </span>
      </div>
      {review.wentWell !== null ? (
        <div>
          <p className="review-row-label">
            {review.seasonName === null ? "What went well" : "Their review"}
          </p>
          <p className="review-row-text">{review.wentWell}</p>
        </div>
      ) : null}
      {review.improve !== null ? (
        <div>
          <p className="review-row-label">What to improve</p>
          <p className="review-row-text">{review.improve}</p>
        </div>
      ) : null}
      {review.mayQuote ? (
        <p className="pass-row-sub">
          Signed: {review.displayName}
          {review.displayOrg === null ? "" : `, ${review.displayOrg}`}
        </p>
      ) : null}
      {review.organizerReply !== null ? (
        <div>
          <p className="review-row-label">The club&apos;s reply</p>
          <p className="review-row-text">{review.organizerReply}</p>
        </div>
      ) : null}
      {review.reports.length > 0 ? (
        <div className="review-row-reports">
          <p className="review-row-label">Why readers reported it</p>
          <ul>
            {review.reports.map((report, index) => (
              <li key={index}>
                <strong>{REASON_WORDS[report.reason] ?? report.reason}</strong>
                {report.note === null ? null : ` — ${report.note}`}{" "}
                <span className="admin-meta">{day(report.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="review-row-actions">
        {review.reports.length > 0 && review.status === "published" ? (
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => {
              start(async () => {
                const result = await dismissReportsAction(review.id);
                toast({
                  title: result.ok ? result.summary : result.error,
                  tone: result.ok ? "success" : "danger",
                });
                router.refresh();
              });
            }}
          >
            Keep it up
          </Button>
        ) : null}
        {review.status !== "published" ? (
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => {
              move("published");
            }}
          >
            Publish
          </Button>
        ) : null}
        {review.status !== "hidden" ? (
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            onClick={() => {
              move("hidden");
            }}
          >
            Hide
          </Button>
        ) : null}
      </div>
    </li>
  );
}

const SOURCE_WORDS: Record<string, string> = {
  manual_admin: "asked from this desk",
  manual_org: "asked by their club",
  auction_completed: "after their auction",
  season_completed: "after their season",
};

function AsksCard({ asks }: { asks: readonly DeskAsk[] }) {
  return (
    <SectionCard
      icon={<IconMail />}
      tone="neutral"
      title={"Who we've asked"}
      description={`${String(asks.length)} asked`}
      flush
      data-testid="review-desk-asks"
    >
      <ul className="admin-rows">
        {asks.map((ask) => {
          const state = ask.reviewed
            ? { tone: "green" as const, words: "reviewed" }
            : ask.expired
              ? { tone: "neutral" as const, words: "link expired" }
              : ask.openedAt !== null
                ? { tone: "blue" as const, words: "opened, not reviewed" }
                : ask.sentAt !== null
                  ? { tone: "amber" as const, words: "emailed, not opened" }
                  : { tone: "amber" as const, words: "link not emailed" };
          return (
            <li key={ask.id}>
              <span className="admin-cell-main">
                <span className="admin-name">{ask.personName ?? "No name"}</span>
                {ask.personEmail === null ? null : (
                  <span className="admin-meta" data-private>
                    {ask.personEmail}
                  </span>
                )}
              </span>
              <span className="review-asks-state">
                <Pill tone={state.tone}>{state.words}</Pill>
                <span className="admin-meta">
                  {SOURCE_WORDS[ask.source] ?? ask.source} · {day(ask.createdAt)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
