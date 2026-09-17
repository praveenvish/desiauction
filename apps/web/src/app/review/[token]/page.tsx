import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "../../../server/db";
import { markAskOpened, reviewPageState } from "../../../server/reviews/reviews";
import { ReviewForm } from "./review-form";
import "../../content.css";
import "./review.css";

export const metadata: Metadata = {
  title: "Your review · DesiAuction",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * A REVIEW, HELD OPEN BY A LINK (FR-1 Phase 2).
 *
 * The token in the path is the whole authorisation, as on `/demo/[token]`: no
 * session, no tenant. An unknown token is `notFound()` — the same to somebody
 * guessing as a page that does not exist. An EXPIRED one is said plainly: only
 * the person the link was sent to can hold a valid-looking token, so telling
 * them it lapsed gives a guesser nothing.
 *
 * NO `loading.tsx` MAY BE ADDED ABOVE THIS ROUTE — a Suspense boundary commits
 * a 200 before this gate runs.
 */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await reviewPageState(db, token);

  if (state.kind === "unknown") {
    notFound();
  }

  if (state.kind === "expired") {
    return (
      <main className="content-page content-narrow">
        <h1>This link has expired</h1>
        <p className="content-lead">
          Review links last thirty days. If you&apos;d still like to tell us how it went, write to{" "}
          <a href="mailto:support@desiauction.in" className="prose-link">
            support@desiauction.in
          </a>{" "}
          and we&apos;ll send a fresh one.
        </p>
      </main>
    );
  }

  if (state.kind === "closed") {
    return (
      <main className="content-page content-narrow">
        <h1>Thanks — we have your review</h1>
        <p className="content-lead">
          It&apos;s been read by the team, so it can&apos;t be changed from this link any more. If
          you want something taken down or corrected, write to{" "}
          <a href="mailto:support@desiauction.in" className="prose-link">
            support@desiauction.in
          </a>
          .
        </p>
        <p className="prose-p">
          <Link href="/" className="prose-link">
            Back to DesiAuction
          </Link>
        </p>
      </main>
    );
  }

  await markAskOpened(db, state.requestId);

  return (
    <main className="content-page content-narrow">
      <h1>How has DesiAuction worked for you?</h1>
      <p className="content-lead">
        {state.personName === null
          ? ""
          : `Thanks for running your tournament with us, ${state.personName}. `}
        Two minutes, and every word is read. Nothing is shown to anyone unless you say we may quote
        it.
      </p>
      <ReviewForm token={token} suggestedName={state.personName} existing={state.review} />
    </main>
  );
}
