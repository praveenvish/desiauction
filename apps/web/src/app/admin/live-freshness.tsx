"use client";

import { ageLabel, istTime, useNow } from "./use-polled";

/**
 * How fresh the numbers on screen are — the first thing an operator should be
 * able to trust on a live surface. A board that silently stopped refreshing
 * looks exactly like a quiet auction; this line is what tells them apart.
 */
export function LiveFreshness({
  generatedAtMs,
  polling,
  failed,
  revoked,
}: {
  generatedAtMs: number;
  polling: boolean;
  failed: boolean;
  revoked: boolean;
}) {
  const now = useNow();
  if (revoked) {
    return (
      <p className="admin-live-fresh is-danger" role="status" data-testid="live-freshness">
        Your access to this page ended. Reload to continue.
      </p>
    );
  }
  if (failed) {
    return (
      <p className="admin-live-fresh is-warning" role="status" data-testid="live-freshness">
        Couldn&rsquo;t refresh — showing what was true at {istTime(generatedAtMs)}. Retrying.
      </p>
    );
  }
  return (
    <p className="admin-live-fresh" data-testid="live-freshness">
      {polling ? <span className="admin-live-dot" aria-hidden /> : null}
      {polling ? "Refreshing automatically" : "Final"} · as of {istTime(generatedAtMs)}
      {now === null ? null : ` (${ageLabel(now - generatedAtMs)} ago)`}
    </p>
  );
}
