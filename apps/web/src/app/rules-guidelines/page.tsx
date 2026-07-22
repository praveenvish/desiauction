import type { Metadata } from "next";

import { env } from "../../env";
import "../content.css";

export const metadata: Metadata = {
  title: "Rules & guidelines · DesiAuction",
  description: "Ground rules for running a fair player auction on DesiAuction.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/rules-guidelines` },
};

/** Static organizer guidance — no tournament-specific rules (those are each
 * organizer's own), only the platform's own ground rules. Public, no auth. */
export default function RulesGuidelinesPage() {
  return (
    <main className="content-page content-narrow">
      <h1>Rules &amp; guidelines</h1>
      <p className="content-lead">
        DesiAuction doesn't set your tournament's auction rules — purse, base price, team counts and
        bidding format are yours to decide. These are the platform's own ground rules, the same for
        every tournament.
      </p>
      <div className="prose">
        <h2 className="prose-h2">Every bid is final once accepted</h2>
        <p className="prose-p">
          A bid that lands on the server and is accepted by the auctioneer cannot be retracted.
          There is no "undo my own bid" — only the auctioneer's undo, for the current lot, before
          the next bid.
        </p>
        <h2 className="prose-h2">One truth on every screen</h2>
        <p className="prose-p">
          The cockpit, the public stage and every owner's device show the same state at the same
          time. If a device disconnects mid-auction, it reconnects to exactly where the room is — it
          never shows a stale bid as current.
        </p>
        <h2 className="prose-h2">Nothing is edited after the fact</h2>
        <p className="prose-p">
          The auction and the money are an append-only record. A mistake is corrected with a new
          entry that explains itself, not by rewriting history.
        </p>
        <h2 className="prose-h2">Spectators watch, they don't bid</h2>
        <p className="prose-p">
          The public stage needs no sign-in and places no bids — it is a read-only mirror of the
          room, for players, families and fans.
        </p>
      </div>
    </main>
  );
}
