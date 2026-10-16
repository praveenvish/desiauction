"use client";

import { Button, Field, SectionCard } from "@desiauction/ui";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "../../../components/admin/use-step-up";
import type { FlaggedScoredMatch } from "../../../server/admin/moderation-views";
import { moderateScoredMatch } from "../../../server/platform-ops/scoring-trust-actions";
import type { TrustReviewDisposition } from "../../../server/scoring/trust-review";

function MatchReview({ match }: { match: FlaggedScoredMatch }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { run, dialog } = useStepUp();
  const router = useRouter();
  const review = (disposition: TrustReviewDisposition) => {
    startTransition(async () => {
      setError(null);
      const result = await run(() =>
        moderateScoredMatch({
          fixtureId: match.fixtureId,
          orgId: match.orgId,
          attempt: match.attempt,
          lastSeq: match.lastSeq,
          reason,
          disposition,
        }),
      );
      if (!result.ok) setError(result.error);
      else {
        setReason("");
        router.refresh();
      }
    });
  };
  return (
    <SectionCard title={`${match.fixtureNumber} · ${match.seasonName}`}>
      <p>{match.orgName}</p>
      <p>
        {match.reasons.length ? match.reasons.join(", ").replaceAll("_", " ") : "Held for review"}
      </p>
      <p>
        Verify resolves this revision. Keep flagged holds it for review. Exclude keeps the match off
        leaderboards until a platform review lifts the exclusion.
      </p>
      <Field
        name={`review-${match.fixtureId}`}
        label="Reason for this decision"
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
        }}
        minLength={10}
        maxLength={500}
        required
      />
      {error && <p role="alert">{error}</p>}
      <div className="dash-actions">
        <Button
          disabled={pending || reason.trim().length < 10}
          onClick={() => {
            review("verify");
          }}
        >
          Verify
        </Button>
        <Button
          disabled={pending || reason.trim().length < 10}
          onClick={() => {
            review("keep_flagged");
          }}
        >
          Keep flagged
        </Button>
        <Button
          disabled={pending || reason.trim().length < 10}
          onClick={() => {
            review("exclude");
          }}
        >
          Exclude from leaderboards
        </Button>
      </div>
      {dialog}
    </SectionCard>
  );
}
export function ScoredMatchReviews({ matches }: { matches: readonly FlaggedScoredMatch[] }) {
  return (
    <section aria-labelledby="flagged-matches-title">
      <h2 id="flagged-matches-title">Flagged matches</h2>
      {matches.length === 0 ? (
        <p>No completed matches need review.</p>
      ) : (
        matches.map((match) => <MatchReview key={match.fixtureId} match={match} />)
      )}
    </section>
  );
}
