import { ButtonLink, PlayerImage } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { ledgerView } from "../../../../../server/auction/conduct-actions";
import { parseLedgerFilter } from "../../../../../lib/ledger-filter";
import { formatTime } from "../../../../../lib/format-date";
import { moneyFormat } from "../../../../../lib/money";
import { seasonUnit } from "../../../../../server/competition/season-unit";
import "../../../seasons.css";
import "../auction.css";
import { LedgerFilters } from "./ledger-filters";

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
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  const { slug } = await params;
  const { page, filter } = await searchParams;
  const view = await ledgerView(slug, Number(page ?? "1") || 1, parseLedgerFilter(filter));
  if (view === null) {
    notFound();
  }
  const money = moneyFormat(await seasonUnit(slug));
  // The pager keeps the reader's chosen filter (raw — an absent one stays absent
  // so it keeps following the default).
  const rawFilter = parseLedgerFilter(filter);
  const pageHref = (n: number) =>
    `/seasons/${slug}/auction/ledger?${new URLSearchParams({
      ...(rawFilter !== null ? { filter: rawFilter } : {}),
      page: String(n),
    }).toString()}`;
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
            {view.auctionName} · {view.totalRows} rows
            {view.filter === "all" ? "" : ` (${String(view.filteredRows)} shown)`} · regenerated
            from the event log in {view.generationMs.toFixed(1)} ms · immutable, append-only
          </p>
          <LedgerFilters raw={parseLedgerFilter(filter) ?? ""} active={view.filter} />
        </header>
        <div className="table-scroll">
          <table className="reg-table" data-testid="ledger-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th className="ledger-col-minor">Actor</th>
                <th className="ledger-col-minor">Paddle</th>
                <th>Team</th>
                <th>Lot</th>
                <th>Bid</th>
                <th>Result</th>
                <th className="ledger-col-minor">Reason</th>
                <th className="ledger-col-minor">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.length === 0 ? (
                <tr>
                  <td colSpan={10} data-testid="ledger-empty">
                    {view.filter === "bids"
                      ? "No bids yet."
                      : view.filter === "results"
                        ? "No results yet — the first sale will land here."
                        : "Nothing on the record yet."}
                  </td>
                </tr>
              ) : null}
              {view.rows.map((row) => (
                /* `.reg-table` hides its `thead` below 1100px and restores the
                   headings through `td::before { content: attr(data-label) }`
                   (seasons.css). Ten unlabelled cells is an audit record nobody
                   can read on a laptop — and this one is the evidence surface
                   for a disputed bid. */
                <tr key={row.seq} data-testid={`ledger-row-${String(row.seq)}`}>
                  <td data-label="#">{row.seq}</td>
                  <td data-label="Time">{formatTime(row.atMs)}</td>
                  <td data-label="Actor" className="ledger-col-minor">
                    {row.actorName}
                  </td>
                  <td data-label="Paddle" className="ledger-col-minor">
                    {row.paddleNumber ?? "—"}
                  </td>
                  <td data-label="Team">{row.teamName ?? "—"}</td>
                  <td data-label="Lot">
                    {row.lotNumber !== null ? (
                      <span className="ledger-lot">
                        <PlayerImage
                          name={row.playerName ?? row.lotNumber}
                          seed={view.faces[row.lotNumber]?.registrationId ?? row.lotNumber}
                          src={view.faces[row.lotNumber]?.photoUrl}
                          size="xs"
                          shape="round"
                          decorative
                        />
                        {`${row.lotNumber} ${row.playerName ?? ""}`}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Bid">{row.amount !== null ? money.ledger(row.amount) : "—"}</td>
                  <td data-label="Result" className={resultClass(row.result)}>
                    {row.result}
                  </td>
                  <td data-label="Reason" className="ledger-col-minor">
                    {row.reason ?? "—"}
                  </td>
                  <td
                    data-label="Correlation"
                    className="ledger-col-minor"
                    title={row.correlationId}
                  >
                    {row.correlationId.slice(-6)}
                  </td>
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
              <ButtonLink href={pageHref(view.page - 1)} variant="ghost">
                Previous
              </ButtonLink>
            ) : (
              <span />
            )}
            <span data-testid="ledger-page-indicator">
              Page {view.page} of {view.totalPages}
            </span>
            {view.page < view.totalPages ? (
              <ButtonLink href={pageHref(view.page + 1)} variant="ghost">
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
