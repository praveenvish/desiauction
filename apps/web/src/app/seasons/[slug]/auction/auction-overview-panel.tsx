import type { MoneyUnit } from "@desiauction/core";
import { Card, PlayerImage } from "@desiauction/ui";

import { moneyFormat } from "../../../../lib/money";
import { roleLabeller } from "../../../../lib/role-label";
import type { AuctionOverview } from "../../../../server/auction/auction-overview";

/**
 * The Auction tab's operational dashboard (PX "Season Workspace" → Auction).
 *
 * A read of committed state, deliberately: progress, what is on the block, the
 * per-paddle purse burndown, the queue and the tail of the event log. The live
 * timer and the bidding itself live on /live and /cockpit, which stream the
 * same auction — this page does not fake a countdown it cannot keep.
 */

export function AuctionOverviewPanel({
  overview,
  idleHint = "No lot is under the hammer. Open the cockpit to put the next one up.",
  unit = "inr",
  finished = false,
}: {
  overview: AuctionOverview;
  /** What an empty block says — the organizer is told where to act; an observer is not. */
  idleHint?: string;
  /**
   * What the season counts in (0091). A prop, not `useMoney()`: this panel is
   * mounted by /admin, outside any season's provider.
   */
  unit?: MoneyUnit;
  /**
   * The auction is over (completed, reconciled or abandoned). A finished night
   * has nothing on the block and nothing queued, so the block card — "Nothing
   * on the block — no lot is under the hammer right now" — and the zero counts
   * stop being information.
   */
  finished?: boolean;
}) {
  const money = moneyFormat(unit);
  const { counts, totalLots, moneyMoved, paddles, onBlock } = overview;
  const labelOf = roleLabeller(overview.roles);
  const pct = (n: number) => (totalLots > 0 ? (n / totalLots) * 100 : 0);
  /* Points are spent, not moved — and "1.75 L pts" reads as lakhs of rupees
     at a glance, so a points season gets the exact figure. */
  const spent =
    unit === "points"
      ? `Points spent · ${money.exact(moneyMoved)}`
      : `Money moved · ${money.compact(moneyMoved)}`;

  return (
    <>
      <Card data-testid="auction-progress-summary">
        <div className="teams-head">
          <div className="teams-head-title">
            <h2>Auction progress</h2>
          </div>
          {/* "Queued" here means exactly what the open guard means by it.
              Prepared lots are named separately — they are what "Queue all
              prepared" is for, and calling them queued is how this card came
              to claim 14 queued while the door said none. */}
          <span className="competitions-hint" data-testid="auction-progress-counts">
            {finished ? (
              <>
                {counts.sold} sold · {counts.unsold} unsold
              </>
            ) : (
              <>
                {counts.sold} sold · {counts.onBlock} on block · {counts.queued} queued ·{" "}
                {counts.prepared} prepared · {counts.unsold} unsold
              </>
            )}
          </span>
        </div>
        <span className="auc-progress" aria-hidden>
          <span
            className="auc-progress-seg is-sold"
            style={{ width: `${String(pct(counts.sold))}%` }}
          />
          <span
            className="auc-progress-seg is-block"
            style={{ width: `${String(pct(counts.onBlock))}%` }}
          />
          <span
            className="auc-progress-seg is-unsold"
            style={{ width: `${String(pct(counts.unsold))}%` }}
          />
        </span>
        <div className="auc-progress-foot">
          <span className="auc-legend">
            <span className="auc-key is-sold" /> Sold {counts.sold}
            {finished ? null : (
              <>
                <span className="auc-key is-block" /> On block {counts.onBlock}
              </>
            )}
            <span className="auc-key is-unsold" /> Unsold {counts.unsold}
          </span>
          <span className="auc-money">{spent}</span>
        </div>
        {counts.queued === 0 && counts.prepared > 0 && !finished ? (
          <p className="competitions-hint" data-testid="nothing-queued-hint">
            Nothing is queued yet. {counts.prepared} prepared lot
            {counts.prepared === 1 ? " is" : "s are"} waiting for “Queue all prepared” — the auction
            cannot open until at least one lot is queued.
          </p>
        ) : null}
      </Card>

      <div className="auc-split">
        {finished ? null : (
          <Card data-testid="on-block-card">
            <div className="teams-head">
              <div className="teams-head-title">
                <h2 className="auc-block-title">
                  {onBlock !== null ? (
                    <>
                      <span className="auc-live-dot" aria-hidden />
                      On the block now
                    </>
                  ) : (
                    "Nothing on the block"
                  )}
                </h2>
              </div>
            </div>
            {onBlock === null ? (
              <p className="competitions-hint">{idleHint}</p>
            ) : (
              <>
                <div className="auc-block-player">
                  <PlayerImage
                    name={onBlock.playerName ?? "Unnamed"}
                    seed={onBlock.registrationId}
                    src={onBlock.photoUrl}
                    size="md"
                    shape="round"
                    decorative
                  />
                  <span className="roster-person">
                    <span className="roster-name">{onBlock.playerName ?? "Unnamed"}</span>
                    <span className="competitions-hint">
                      {labelOf(onBlock.role)} · base {money.exact(onBlock.basePrice)}
                    </span>
                  </span>
                </div>
                <div className="auc-bid">
                  <div>
                    <span className="team-card-money-lbl">Current bid</span>
                    <span className="auc-bid-value">
                      {onBlock.currentBid !== null
                        ? money.exact(onBlock.currentBid)
                        : "No bids yet"}
                    </span>
                  </div>
                  {onBlock.leadingTeamName !== null ? (
                    <div className="auc-bid-leader">
                      <span className="team-card-money-lbl">Leading</span>
                      <span className="fx-team">
                        <span
                          className="fx-dot"
                          style={{ background: onBlock.leadingColor ?? "var(--accent)" }}
                          aria-hidden
                        />
                        {onBlock.leadingTeamName}
                      </span>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </Card>
        )}

        <Card data-testid="purse-burndown">
          <div className="teams-head">
            <div className="teams-head-title">
              <h2>Paddle purse burndown</h2>
            </div>
            <span className="competitions-hint">
              {paddles.length} paddle{paddles.length === 1 ? "" : "s"}
            </span>
          </div>
          {paddles.length === 0 ? (
            <p className="competitions-hint">No paddles issued yet.</p>
          ) : (
            <ul className="auc-paddles">
              {paddles.map((paddle) => (
                <li key={paddle.paddleNumber} className="auc-paddle">
                  <span className="auc-paddle-top">
                    <span className="auc-paddle-no">{paddle.paddleNumber}</span>
                    <span className="fx-team">
                      <span
                        className="fx-dot"
                        style={{ background: paddle.color ?? "var(--accent)" }}
                        aria-hidden
                      />
                      {paddle.teamName}
                    </span>
                    {/* DA-30: a rival's remaining purse is the one thing an
                        auction keeps back. Without money sight the figure is
                        not dimmed — it was never sent. */}
                    {paddle.remaining !== undefined ? (
                      <span className="auc-paddle-left">
                        {money.compactFloor(paddle.remaining)} left
                      </span>
                    ) : null}
                  </span>
                  {paddle.purseTotal !== undefined && paddle.spent !== undefined ? (
                    <span className="season-bar" aria-hidden>
                      <span
                        className="season-bar-fill"
                        style={{
                          width: `${String(
                            paddle.purseTotal > 0
                              ? Math.round((paddle.spent / paddle.purseTotal) * 100)
                              : 0,
                          )}%`,
                          ...(paddle.color !== null ? { background: paddle.color } : {}),
                        }}
                      />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
