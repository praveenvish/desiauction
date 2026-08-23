"use client";

import { formatPaiseINR, paise, commandRefusalMessage } from "@desiauction/core";
import { Badge, Button, Card, Select, useToast, Dialog, Field } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  submitAuctionCommand,
  type LiveAuctionView,
} from "../../../../../server/auction/live-actions";
import { CeremonyStage } from "../ceremony-stage";
import {
  AuctionProgress,
  AuctionSummaryCard,
  AuctionTimeline,
  ConnectionQuality,
  MyTeamCard,
  useLiveFeed,
} from "../live-experience";
import { PageStatus } from "../../../../../components/shell/page-status";
import { AuctionAnnouncer } from "../auction-announcer";
import { GavelButton } from "../cockpit/gavel-button";
import { LotHero } from "../lot-hero";
import { PaddleControl } from "../paddle-control";
import { PurseBoard } from "../purse-board";
import { PoolSummary, SquadBoard } from "../squad-board";
import { StatusRibbon } from "../status-ribbon";
import { useAuctionSocket } from "../use-auction-socket";

// The live client (M-IP4-2, rewired M-IP4-3). This component DECIDES NOTHING:
// it renders the broadcast AuctionSnapshot (shared socket hook), sends
// commands, and shows acknowledgements. Claims are grant-gated: only teams
// this person holds a paddle grant for are claimable (the production owner
// model) — and the engine enforces it regardless.

const AUCTION_TONE = {
  scheduled: "info",
  live: "success",
  paused: "warning",
  completed: "neutral",
  reconciled: "neutral",
  abandoned: "danger",
} as const;

function commandId(): string {
  return crypto.randomUUID();
}

export function LivePanel({ slug, view }: { slug: string; view: LiveAuctionView }) {
  const router = useRouter();
  const toast = useToast();
  const { snapshot, connection, remainingMs, version, ceremony, drift, stale, offline, clock } =
    useAuctionSocket(view.wsUrl);
  const feed = useLiveFeed(view.resolved, snapshot);
  // The device being offline is as good a reason to stop taking bids as the
  // socket being down — both mean the snapshot on screen is a memory.
  const readOnly = stale;
  const [claimTeam, setClaimTeam] = useState(view.myPaddle?.teamId ?? "");
  /**
   * DA: ONE global `busy` flag used to disable every button on the page while
   * any command was in flight — including the gavel. Waiting on "Queue lots"
   * is not a reason to take the gavel away from the auctioneer. The pending
   * key names the ONE control that is actually working.
   */
  const [pending, setPending] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  /**
   * THE ROUND TRIP CAN FAIL, AND IT USED TO FAIL SILENTLY FOREVER.
   *
   * `submitAuctionCommand` is defended at its far end: engine-client gives the
   * engine two seconds and answers `engine_unreachable` rather than throwing.
   * The near end — the browser's request to the server action itself — was not.
   * A phone that loses signal in the hall, a server restart, a proxy hiccup:
   * the promise REJECTS, and with `setPending(null)` sitting on the happy path
   * it never ran. The control stayed disabled for the rest of the session and
   * nothing was said. On the raise button, whose only disabled treatment is
   * `opacity: .55`, that is a bidder tapping a dimmed rectangle and never
   * learning whether their money moved.
   *
   * `finally` gives the control back no matter what, and the catch says the one
   * thing the bidder needs to know: the bid did NOT land.
   */
  const send = useCallback(
    async (key: string, type: string, payload: Record<string, unknown>, done?: string) => {
      setPending(key);
      let ack;
      try {
        ack = await submitAuctionCommand(slug, commandId(), type, payload);
      } catch {
        // DO NOT CLAIM THE COMMAND FAILED. A rejected promise means the ANSWER
        // did not come back; it does not mean the request never arrived. The
        // server action can reach the engine and have the reply lost on the way
        // home, in which case the bid IS recorded. Telling a bidder "that didn't
        // go through" there would invite them to bid against themselves.
        //
        // So the message states only what is known — the answer is missing — and
        // points at the one thing that is authoritative: the bid feed, which is
        // server truth streamed over the socket, not this optimistic client.
        toast({
          title:
            "Lost the connection before the auction answered — check the bid feed before bidding again.",
          tone: "danger",
        });
        return false;
      } finally {
        setPending(null);
      }
      if (ack.accepted) {
        if (done !== undefined) {
          toast({ title: done, tone: "success" });
        }
        return true;
      }
      toast({ title: commandRefusalMessage(ack.reason), tone: "danger" });
      return false;
    },
    [slug, toast],
  );
  const bidBusy = pending === "bid";

  // DA-02: which of my paddles is bidding. A conductor running the night from
  // one laptop holds several; the room used to bind to the first one for ever.
  const [activePaddleId, setActivePaddleId] = useState<string | null>(null);
  const myPaddle =
    view.myPaddles.find((entry) => entry.paddleId === activePaddleId) ?? view.myPaddle;

  const claim = async () => {
    if (await send("claim", "ClaimPaddle", { teamId: claimTeam }, "Paddle claimed")) {
      router.refresh();
    }
  };

  // DA-02: a paddle binds its holder to one team for the night, and the command
  // to hand it back has existed in the aggregate since M-IP4-3 with nobody able
  // to reach it. Without this, a paddle issued to the wrong person stranded that
  // team for the whole auction — Abort was the only way out.
  const release = async () => {
    const teamId = myPaddle?.teamId;
    if (teamId === undefined) {
      return;
    }
    if (await send("release", "ReleasePaddle", { teamId }, "Paddle released")) {
      router.refresh();
    }
  };

  // DA-06/DA-16: the live room conducts too, so closing the night here follows
  // the same rule as the cockpit — confirm, and if squads are short, take a
  // reason that lands in the ledger. Not window.confirm: native dialogs ignore
  // the theme and are auto-dismissed by automation, which made the path
  // untestable.
  const [completeOpen, setCompleteOpen] = useState(false);
  const [shortSquads, setShortSquads] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const confirmComplete = async () => {
    const payload = shortSquads
      ? { overrideSquadMinimum: true, reason: overrideReason.trim() }
      : {};
    let ack;
    try {
      ack = await submitAuctionCommand(slug, commandId(), "CompleteAuction", payload);
    } catch {
      // Same rule as `send` above: an unanswered request is not a failed one,
      // and "the night is still open" would be a claim this code cannot make.
      toast({
        title:
          "Lost the connection before the auction answered — reload to see whether the night closed.",
        tone: "danger",
      });
      return;
    }
    if (ack.accepted) {
      setCompleteOpen(false);
      setShortSquads(false);
      toast({ title: "Auction completed", tone: "success" });
      router.refresh();
      return;
    }
    if (ack.reason === "squad_below_minimum") {
      setShortSquads(true);
      return;
    }
    toast({ title: commandRefusalMessage(ack.reason), tone: "danger" });
  };

  const bid = async (amount: number) => {
    if (myPaddle === null) {
      toast({ title: "Claim a paddle first.", tone: "danger" });
      return;
    }
    const lotId = snapshot?.currentLot?.lotId;
    if (lotId === undefined) {
      return;
    }
    await send("bid", "PlaceBid", { lotId, paddleId: myPaddle.paddleId, amountRaw: amount });
  };

  // PX-6 bidder notifications: outbid (I was leading, now someone else) and
  // won (last outcome SOLD to my paddle). Pure observation of server truth.
  const prevLeaderRef = useRef<string | null>(null);
  const wonSeqRef = useRef<number>(0);
  useEffect(() => {
    if (snapshot === null || myPaddle === null) {
      return;
    }
    const mine = myPaddle.paddleNumber;
    const leader = snapshot.currentLot?.currentBid?.paddleNumber ?? null;
    if (prevLeaderRef.current === mine && leader !== null && leader !== mine) {
      const amount = snapshot.currentLot?.currentBid?.amount;
      toast({
        title: `Outbid — ${snapshot.currentLot?.currentBid?.teamName ?? "another team"}${amount !== undefined ? ` at ${formatPaiseINR(paise(amount))}` : ""}`,
        tone: "info",
      });
    }
    prevLeaderRef.current = leader;
    const outcome = snapshot.lastOutcome;
    if (
      outcome !== null &&
      outcome.atSeq > wonSeqRef.current &&
      outcome.kind.toLowerCase() === "sold" &&
      outcome.paddleNumber === mine
    ) {
      wonSeqRef.current = outcome.atSeq;
      toast({
        title: `You signed ${outcome.playerName ?? outcome.lotNumber}${outcome.amount !== null ? ` for ${formatPaiseINR(paise(outcome.amount))}` : ""}!`,
        tone: "success",
      });
    }
  }, [snapshot, myPaddle, toast]);

  const lot = snapshot?.currentLot ?? null;
  const grantedTeams = view.teams.filter((team) => view.myGrantTeamIds.includes(team.id));
  // The squad board's row universe. A conductor keeps every franchise; a bidder
  // gets their own — see `viewer.canSeeAllSquads`.
  const boardTeams = view.viewer.canSeeAllSquads
    ? view.teams
    : view.teams.filter((team) => view.myTeamIds.includes(team.id));
  const myTeam = view.teams.find((team) => team.id === myPaddle?.teamId);
  // The ring measures against the window the lot is actually running: an
  // extended lot restarts on the anti-snipe clock, not the opening one.
  const lotDurationMs =
    ((lot?.extensions ?? 0) > 0 ? view.rules.extensionSeconds : view.rules.initialSeconds) * 1000;
  const leadColor =
    view.teams.find((team) => team.name === lot?.currentBid?.teamName)?.primaryColor ?? null;
  const mySquadSigned = feed.resolved.filter(
    (resolvedLot) =>
      resolvedLot.status === "sold" &&
      (resolvedLot.teamId === myPaddle?.teamId || resolvedLot.teamName === myPaddle?.teamName),
  ).length;
  /** The auction is not taking bids — paused, or over. */
  const notTakingBids = snapshot !== null && snapshot.auctionStatus !== "live";
  const finished =
    snapshot !== null &&
    (snapshot.auctionStatus === "completed" ||
      snapshot.auctionStatus === "reconciled" ||
      snapshot.auctionStatus === "abandoned");

  return (
    <div
      className="competitions-stack"
      data-testid="live-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <AuctionAnnouncer snapshot={snapshot} ceremony={ceremony} remainingMs={remainingMs} />
      {/* The ribbon rides in the Live shell's header, as it already did on
          /spectate. Two sticky bars used to sit at top: 0 and OVERLAP (measured
          0-69 and 0-74) — the shell's header and the page's own ribbon, each
          unaware of the other. One bar now, and 74px of the phone back. */}
      <PageStatus>
        <StatusRibbon
          snapshot={snapshot}
          connection={connection}
          remainingMs={remainingMs}
          variant="shell"
          offline={offline}
        />
      </PageStatus>

      {readOnly && snapshot !== null ? (
        <p role="alert" className="live-readonly" data-testid="readonly-banner">
          Reconnecting — you&apos;re seeing the last known state; bidding is disabled until
          we&apos;re live again.
        </p>
      ) : null}

      {snapshot !== null && snapshot.auctionStatus === "completed" ? (
        <AuctionSummaryCard
          snapshot={snapshot}
          feed={feed}
          slug={slug}
          canConduct={view.viewer.canConduct}
          viewerTeamName={myPaddle?.teamName ?? null}
        />
      ) : null}

      {/* Two columns, as the Owner Room comp has it: the lot and the paddle on
          the left where the eye lives, the board on the right. */}
      <div className="live-grid">
        <div className="live-col">
          {lot !== null ? (
            <>
              <LotHero
                lot={lot}
                remainingMs={remainingMs}
                lotDurationMs={lotDurationMs}
                leadColor={leadColor}
                frozen={notTakingBids}
                clock={clock}
              />
              {myPaddle !== null ? (
                <PaddleControl
                  lot={lot}
                  rules={view.rules}
                  snapshot={snapshot}
                  myPaddleNumber={myPaddle.paddleNumber}
                  myTeam={myTeam}
                  squadSigned={mySquadSigned}
                  disabled={readOnly || bidBusy}
                  onBid={(amount) => {
                    void bid(amount);
                  }}
                />
              ) : null}
            </>
          ) : (
            /* Between lots the owner sees exactly what the room sees. */
            <CeremonyStage snapshot={snapshot} ceremony={ceremony} remainingMs={remainingMs} />
          )}

          <Card data-testid="bid-feed">
            <div className="competition-head">
              <h2>Bid feed</h2>
              {connection === "open" ? <span className="live-pulse" aria-hidden /> : null}
            </div>
            {lot === null || lot.bidHistory.length === 0 ? (
              <p className="competitions-hint" data-testid="bid-feed-empty">
                {lot === null
                  ? "Bids appear here once a lot opens."
                  : "Bids will appear here the moment they land."}
              </p>
            ) : (
              <ol className="timeline" data-testid="bid-history">
                {[...lot.bidHistory].reverse().map((entry) => (
                  <li key={entry.bidId}>
                    <Badge tone="neutral">{entry.paddleNumber}</Badge>
                    <span>{entry.teamName}</span>
                    <span className="timeline-at">{formatPaiseINR(paise(entry.amount))}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <AuctionTimeline feed={feed} />
        </div>

        <div className="live-col">
          {/* The owner workspace exists from the moment the paddle is claimed —
              lot or no lot. Bidding (PaddleControl, left) comes and goes with
              the lot; "what have I got and what can I spend" does not. */}
          {myPaddle !== null ? (
            <MyTeamCard
              snapshot={snapshot}
              myTeamId={myPaddle.teamId}
              myTeamName={myPaddle.teamName}
              myPaddleNumber={myPaddle.paddleNumber}
              rules={view.rules}
              feed={feed}
            />
          ) : null}
          {/* Unconditional now: AuctionProgress renders its own connecting state,
              and the guard here was what made the column re-flow when the socket
              answered — this component sits above the purse board, the pool
              summary and the squad board, so its arrival moved all three. */}
          <AuctionProgress snapshot={snapshot} />
          {/* THE SEAL. A bidder sees their own purse and committed spend, the
              lot on the block and the public bid feed — not every rival's
              remaining money. Decided on the server (`viewer.canSeeAllPurses`)
              and obeyed here; the conductor's board is unchanged. */}
          <PurseBoard
            snapshot={snapshot}
            teams={view.teams}
            myPaddleNumber={myPaddle?.paddleNumber ?? null}
            visibleTeamIds={view.viewer.canSeeAllPurses ? null : view.myTeamIds}
            heading={view.viewer.canSeeAllPurses ? "Purses" : "Your purse"}
            note={
              view.viewer.canSeeAllPurses
                ? null
                : "Rivals' remaining purses are sealed — you see your own."
            }
          />
          <PoolSummary snapshot={snapshot} resolved={feed.resolved} preSigned={view.preSigned} />
        </div>
      </div>

      <SquadBoard
        teams={boardTeams}
        preSigned={view.preSigned}
        resolved={feed.resolved}
        snapshot={snapshot}
        squadMax={view.rules.squadMax}
        showPurse={view.viewer.canSeeAllPurses}
        note={
          view.viewer.canSeeAllSquads
            ? null
            : "Your squad. Every sale is called out in the room and appears in the bid feed."
        }
      />

      {/* The claim door. Once a paddle is held, PaddleControl above owns the
          "Your paddle" heading and states the same fact in its header, so this
          card would be a second panel of the same name saying the same thing. */}
      <Card data-testid="paddle-panel">
        <h2>{myPaddle !== null ? "Paddle status" : "Claim your paddle"}</h2>
        {myPaddle !== null ? (
          <div className="date-row">
            <p data-testid="my-paddle" className="registration-name">
              {myPaddle.paddleNumber} · bidding for {myPaddle.teamName}
            </p>
            {/* Holding several paddles is legitimate — one laptop, one
                auctioneer, a small club. What was missing is the way to say
                which one is bidding right now. */}
            {view.myPaddles.length > 1 ? (
              <Select
                label="Bidding as"
                name="activePaddle"
                value={myPaddle.paddleId}
                onChange={(event) => {
                  setActivePaddleId(event.target.value);
                }}
                data-testid="paddle-switcher"
              >
                {view.myPaddles.map((entry) => (
                  <option key={entry.paddleId} value={entry.paddleId}>
                    {entry.paddleNumber} · {entry.teamName}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => void release()}
              loading={pending === "release"}
              data-testid="release-paddle"
            >
              Hand back paddle
            </Button>
          </div>
        ) : grantedTeams.length > 0 ? (
          <div className="date-row">
            <Select
              label="Team"
              name="claimTeam"
              value={claimTeam}
              onChange={(event) => {
                setClaimTeam(event.target.value);
              }}
            >
              <option value="">Choose…</option>
              {grantedTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
            <Button
              onClick={() => void claim()}
              loading={pending === "claim"}
              disabled={claimTeam === ""}
              data-testid="claim-paddle"
            >
              Claim paddle
            </Button>
          </div>
        ) : (
          /* DERIVED, not asserted. This told a freshly-accepted owner to
             "accept your owner invitation" — the act they had just completed to
             get to this page. They are in this room precisely BECAUSE they
             accepted (`myTeamIds` is non-empty for anyone who did), so the only
             thing left to say is the one thing they can't do themselves. */
          <p className="competitions-hint" data-testid="no-grant-hint">
            {view.myTeamIds.length > 0
              ? "You're the owner — but a paddle is a separate step. Ask the organizer to grant your paddle; you'll be able to claim it here the moment they do."
              : "No paddle grant yet — ask the organizer to grant your paddle."}
          </p>
        )}
        {snapshot !== null ? (
          <ul className="conflict-list">
            {snapshot.paddles.map((paddle) => (
              <li key={paddle.paddleId} data-testid={`live-paddle-${paddle.paddleNumber}`}>
                <Badge tone={paddle.released ? "neutral" : "info"}>{paddle.paddleNumber}</Badge>
                <span>{paddle.teamName}</span>
                <span className="registration-phone">
                  {paddle.purseRemaining === null || paddle.committed === null
                    ? "purse sealed"
                    : `purse ${formatPaiseINR(paise(paddle.purseRemaining))} · committed ${formatPaiseINR(
                        paise(paddle.committed),
                      )}`}
                  {paddle.released ? " · released" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {view.viewer.canConduct ? (
        <Card data-testid="conduct-panel">
          <h2>Conduct</h2>
          <div className="date-row">
            <Button
              variant="secondary"
              onClick={() => void send("queue", "QueueLots", {}, "Lots queued")}
              loading={pending === "queue"}
              disabled={finished}
              data-testid="conduct-queue"
            >
              Queue lots
            </Button>
            <Button
              onClick={() =>
                void send(
                  "open-lot",
                  "OpenLot",
                  { lotId: snapshot?.queue[0]?.lotId ?? "" },
                  "Lot opened",
                )
              }
              loading={pending === "open-lot"}
              disabled={(snapshot?.queue.length ?? 0) === 0 || lot !== null || notTakingBids}
              data-testid="conduct-open-lot"
            >
              Open next lot{snapshot?.queue[0] ? ` (${snapshot.queue[0].lotNumber})` : ""}
            </Button>
            {/* v1.1 G2: closing a lot is a HOLD, not a click — the same gate the
                cockpit has had all along. This panel was the one place in the
                product where the gavel was still a single tap, so the rule the
                cockpit enforces could be walked around by opening /live. */}
            <GavelButton
              onConfirm={() => {
                void send("close-lot", "CloseLot", { lotId: lot?.lotId ?? "" }, "Lot closed");
              }}
              disabled={lot === null || pending === "close-lot"}
              testId="conduct-close-lot"
              describedBy="live-gavel-hint"
            />
          </div>
          <p className="competitions-hint" id="live-gavel-hint">
            Hold the gavel for a moment to close the lot — a tap will not do it.
          </p>
          <div className="date-row">
            {snapshot?.auctionStatus === "live" ? (
              <Button
                variant="ghost"
                onClick={() => void send("pause", "PauseAuction", {}, "Paused")}
                loading={pending === "pause"}
                data-testid="conduct-pause"
              >
                Pause
              </Button>
            ) : null}
            {snapshot?.auctionStatus === "paused" ? (
              <Button
                variant="ghost"
                onClick={() => void send("resume", "ResumeAuction", {}, "Resumed")}
                loading={pending === "resume"}
                data-testid="conduct-resume"
              >
                Resume
              </Button>
            ) : null}
            {/* A finished auction cannot be completed, undone or recovered. The
                room used to keep offering all three after the night was over. */}
            {finished ? null : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCompleteOpen(true);
                  }}
                  data-testid="conduct-complete"
                >
                  Close auction
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void send("recover", "RecoverAuction", {}, "Recovered — state verified")
                  }
                  loading={pending === "recover"}
                  data-testid="conduct-recover"
                >
                  Recover
                </Button>
              </>
            )}
          </div>
        </Card>
      ) : null}

      {/* FEED DIAGNOSTICS — the operator's convergence check, and the only place
          on this page raw transport words appear. The strip used to sit ABOVE
          the lot, restating `live`, `open`, a version and a drift figure that
          the ribbon already says in the room's own language — four statements
          of transport state on one phone screen, one of them (`OPEN`) the raw
          WebSocket readyState contradicting the ribbon's "Live feed". */}
      <div className="live-diagnostics" data-testid="live-diagnostics">
        <span className="live-diagnostics-label">Feed diagnostics</span>
        <span className="live-substatus-meta">
          <ConnectionQuality
            connection={connection}
            drift={drift}
            stale={stale}
            offline={offline}
          />
          <span className="competitions-hint" data-testid="snapshot-version">
            v{version}
          </span>
          {snapshot !== null ? (
            <Badge tone={AUCTION_TONE[snapshot.auctionStatus]} data-testid="live-status">
              {snapshot.auctionStatus}
            </Badge>
          ) : null}
          <Badge
            tone={connection === "open" ? "success" : "warning"}
            data-testid="connection-state"
          >
            {connection}
          </Badge>
        </span>
      </div>
      <Dialog
        open={completeOpen}
        onClose={() => {
          setCompleteOpen(false);
          setShortSquads(false);
        }}
        title={shortSquads ? "Close the auction short?" : "Complete the auction?"}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCompleteOpen(false);
                setShortSquads(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirmComplete()}
              disabled={shortSquads && overrideReason.trim() === ""}
              data-testid="confirm-complete"
            >
              {shortSquads ? "Close short — on the record" : "Complete auction"}
            </Button>
          </>
        }
      >
        {shortSquads ? (
          <>
            <p data-testid="complete-short-warning">
              Some teams are below the minimum squad size of {view.rules.squadMin}. Closing anyway
              is recorded against your name and stays on the ledger for ever.
            </p>
            <Field
              label="Why are you closing short?"
              name="overrideReason"
              value={overrideReason}
              onChange={(event) => {
                setOverrideReason(event.target.value);
              }}
              data-testid="override-reason"
            />
          </>
        ) : (
          <p data-testid="complete-summary">
            {snapshot?.lotsResolved ?? 0} of {snapshot?.lotsTotal ?? 0} lots resolved. This cannot
            be undone.
          </p>
        )}
      </Dialog>
    </div>
  );
}
