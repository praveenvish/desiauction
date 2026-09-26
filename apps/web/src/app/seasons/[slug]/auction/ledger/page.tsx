import {
  ButtonLink,
  EmptyState,
  IconClock,
  IconGavel,
  Pager,
  PlayerImage,
  Toolbar,
  ToolbarCount,
  ToolbarSpacer,
} from "@desiauction/ui";
import Link from "next/link";
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

/** The result as a tone: a status pill's dot colour. Words stay in ink. */
function resultTone(result: string): "sold" | "undo" | "rejected" | "unsold" | "neutral" {
  if (result === "SOLD") {
    return "sold";
  }
  if (result.startsWith("UNDO") || result === "Bid voided") {
    return "undo";
  }
  if (result === "Bid rejected") {
    return "rejected";
  }
  if (result === "UNSOLD" || result === "Lot withdrawn") {
    return "unsold";
  }
  return "neutral";
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
    <main className="registrations-dash ledger-page">
      <div className="dash-stack">
        {/* ONE ROW (wow pass). The head used to stack three bands: two buttons,
            a technical sentence, then the chips. Now: the readings on the
            left, the count and the audit switch, then the two sibling views. */}
        <Toolbar className="ledger-toolbar">
          <LedgerFilters
            raw={rawFilter ?? ""}
            active={view.filter}
            counts={{ [view.filter]: view.filteredRows }}
          />
          <ToolbarSpacer />
          <ToolbarCount>
            <span
              data-testid="ledger-meta"
              title={`${view.auctionName} — regenerated from the event log in ${view.generationMs.toFixed(1)} ms`}
            >
              {view.filter === "all"
                ? `${String(view.totalRows)} rows`
                : `${String(view.filteredRows)} of ${String(view.totalRows)} rows`}{" "}
              · as recorded
            </span>
          </ToolbarCount>
          {/* Actor, paddle, reason and correlation are the DISPUTE columns,
              read at a desk when a bid is contested. Off by default; a CSS-only
              switch (no script), so the server page stays a server page. */}
          <label className="ledger-audit-toggle">
            <input type="checkbox" id="ledger-audit" className="ledger-audit-input" />
            <span className="ledger-audit-track" aria-hidden />
            Audit columns
          </label>
          <span className="ledger-views">
            <ButtonLink href={`/seasons/${slug}/auction/cockpit`} variant="ghost" size="sm">
              <IconGavel size={16} />
              Cockpit
            </ButtonLink>
            {/* The ledger and the replay viewer are two readings of the same
                event log and neither knew the other existed. */}
            <ButtonLink href={`/seasons/${slug}/auction/replay`} variant="ghost" size="sm">
              <IconClock size={16} />
              Replay viewer
            </ButtonLink>
          </span>
        </Toolbar>
        <div className="ledger-scroll">
          <table className="ledger-grid" data-testid="ledger-table">
            <thead>
              <tr>
                <th className="ledger-c-seq">#</th>
                <th className="ledger-c-time">Time</th>
                <th className="ledger-col-minor">Actor</th>
                <th className="ledger-c-lot">Lot</th>
                <th className="ledger-c-team">Team</th>
                <th className="ledger-c-bid">Bid</th>
                <th className="ledger-c-result">Result</th>
                <th className="ledger-col-minor">Reason</th>
                <th className="ledger-col-minor">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} data-testid="ledger-empty" className="ledger-empty">
                    <EmptyState
                      size="compact"
                      icon={<IconGavel />}
                      title={
                        view.filter === "bids"
                          ? "No bids yet"
                          : view.filter === "results"
                            ? "No results yet"
                            : "Nothing on the record yet"
                      }
                      {...(view.filter === "results"
                        ? { description: "The first sale will land here." }
                        : {})}
                    />
                  </td>
                </tr>
              ) : null}
              {view.rows.map((row) => (
                /* On a phone the row is a two-line list item (lot + result
                   over time · team · bid) — never a stack of labelled cells:
                   seven labels per row made a finished ledger ~125pt a row. */
                <tr key={row.seq} data-testid={`ledger-row-${String(row.seq)}`}>
                  <td className="ledger-c-seq">{row.seq}</td>
                  <td className="ledger-c-time">{formatTime(row.atMs)}</td>
                  <td className="ledger-col-minor">{row.actorName}</td>
                  <td className="ledger-c-lot">
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
                        <span className="ledger-lot-code">{row.lotNumber}</span>
                        <span className="ledger-lot-name">{row.playerName ?? ""}</span>
                      </span>
                    ) : (
                      <span className="ledger-none">—</span>
                    )}
                  </td>
                  <td className="ledger-c-team">
                    {row.teamName !== null ? (
                      <span className="ledger-team">
                        {row.paddleNumber !== null ? (
                          <span className="ledger-paddle">{row.paddleNumber}</span>
                        ) : null}
                        <span className="ledger-team-name">{row.teamName}</span>
                      </span>
                    ) : (
                      <span className="ledger-none">—</span>
                    )}
                  </td>
                  <td className="ledger-c-bid">
                    {row.amount !== null ? (
                      money.ledger(row.amount)
                    ) : (
                      <span className="ledger-none">—</span>
                    )}
                  </td>
                  <td className="ledger-c-result">
                    <span className="ledger-result" data-tone={resultTone(row.result)}>
                      {row.result}
                    </span>
                  </td>
                  <td className="ledger-col-minor">{row.reason ?? "—"}</td>
                  <td className="ledger-col-minor" title={row.correlationId}>
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
          <Pager
            label="Ledger pages"
            total={view.filteredRows}
            page={view.page}
            pageCount={view.totalPages}
            shown={view.rows.length}
            noun="rows"
            hrefFor={pageHref}
            linkComponent={Link}
            summaryTestId="ledger-page-indicator"
          />
        ) : null}
      </div>
    </main>
  );
}
