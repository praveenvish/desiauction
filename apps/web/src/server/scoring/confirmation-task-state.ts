import {
  effectiveTrustDecisions,
  sameTrustRevision,
  type TrustEvidence,
  type TrustRevision,
} from "./trust-ledger";

/** A team's accepted response and a legal review link are separate facts. */
export function confirmationTaskState(
  evidence: readonly TrustEvidence[],
  revision: TrustRevision,
  teamId: string,
) {
  const response = [...evidence]
    .filter(
      (row) =>
        row.action === "match.trust.confirmation" &&
        row.meta.teamId === teamId &&
        sameTrustRevision(row.meta, revision) &&
        typeof row.meta.trustOrder === "number",
    )
    .sort((a, b) => Number(a.meta.trustOrder) - Number(b.meta.trustOrder))
    .at(-1);
  const decisions = effectiveTrustDecisions(evidence, revision);
  const resolved =
    decisions.organiserVerified && !decisions.manualHold && !decisions.platformExcluded;
  const underReview =
    decisions.manualHold ||
    decisions.platformExcluded ||
    (decisions.disputed && !decisions.organiserVerified);
  return resolved ? "resolved" : response ? (underReview ? "waiting" : "completed") : "ready";
}
