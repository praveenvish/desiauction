import { formatPaiseINR, paise } from "@desiauction/core";
import { ButtonLink } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { ledgerView } from "../../../../../server/auction/conduct-actions";
import { formatTime } from "../../../../../lib/format-date";
import "../../../seasons.css";
import "../auction.css";

export const metadata = { title: "Auction ledger · DesiAuction" };

// THE AUCTION LEDGER (M-IP4-3): the human-readable operational history — a
// pure projection of the immutable event store, regenerated on every read.
// Sequence · timestamp · actor · paddle · team · lot · bid · result · reason ·
// correlation. Server-rendered; there is nothing to mutate.

function resultClass(result: string): string {
  if (result === "SOLD") {
    return "ledger-result-sold";
  }
  if (result.startsWith("UNDO") || result === "Bid voided") {
    return "ledger-result-undo";
  }
  if (result === "Bid rejected") {
    return "ledger-result-rejected";
  }
  return "";
}

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page } = await searchParams;
  const view = await ledgerView(slug, Number(page ?? "1") || 1);
  if (view === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <header className="dash-head">
          <div className="competition-title-row title-row-actions">
            <ButtonLink href={`/seasons/${slug}/auction/cockpit`} variant="secondary">
              Cockpit
            </ButtonLink>
            {/* The ledger and the replay viewer are two readings of the same
                event log and neither knew the other existed. */}
            <ButtonLink href={`/seasons/${slug}/auction/replay`} variant="secondary">
              Replay viewer
            </ButtonLink>
          </div>
          <p className="competitions-hint" data-testid="ledger-meta">
            {view.auctionName} · {view.totalRows} rows · regenerated from the event log in{" "}
            {view.generationMs.toFixed(1)} ms · immutable, append-only
          </p>
        </header>
        <div className="table-scroll">
          <table className="reg-table" data-testid="ledger-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Actor</th>
                <th>Paddle</th>
                <th>Team</th>
                <th>Lot</th>
                <th>Bid</th>
                <th>Result</th>
                <th>Reason</th>
                <th>Correlation</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.seq} data-testid={`ledger-row-${String(row.seq)}`}>
                  <td>{row.seq}</td>
                  <td>{formatTime(row.atMs)}</td>
                  <td>{row.actorName}</td>
                  <td>{row.paddleNumber ?? "—"}</td>
                  <td>{row.teamName ?? "—"}</td>
                  <td>
                    {row.lotNumber !== null ? `${row.lotNumber} ${row.playerName ?? ""}` : "—"}
                  </td>
                  <td>{row.amount !== null ? formatPaiseINR(paise(row.amount)) : "—"}</td>
                  <td className={resultClass(row.result)}>{row.result}</td>
                  <td>{row.reason ?? "—"}</td>
                  <td title={row.correlationId}>{row.correlationId.slice(-6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* DA-30: the whole fold used to render at once — 900 KB of HTML for a
            44-lot auction, and it grows with the auction. The ledger's
            guarantee is that it regenerates from the log; only the render is
            bounded. */}
        {view.totalPages > 1 ? (
          <nav className="pager" aria-label="Ledger pages">
            {view.page > 1 ? (
              <ButtonLink
                href={`/seasons/${slug}/auction/ledger?page=${String(view.page - 1)}`}
                variant="ghost"
              >
                Previous
              </ButtonLink>
            ) : (
              <span />
            )}
            <span data-testid="ledger-page-indicator">
              Page {view.page} of {view.totalPages}
            </span>
            {view.page < view.totalPages ? (
              <ButtonLink
                href={`/seasons/${slug}/auction/ledger?page=${String(view.page + 1)}`}
                variant="ghost"
              >
                Next
              </ButtonLink>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
    </main>
  );
}
