"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, Button, Card, Select, useToast } from "@desiauction/ui";
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
  const { snapshot, connection, remainingMs, version, ceremony, drift } = useAuctionSocket(
    view.wsUrl,
  );
  const feed = useLiveFeed(view.resolved, snapshot);
  const readOnly = connection !== "open";
  const [claimTeam, setClaimTeam] = useState(view.myPaddle?.teamId ?? "");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const send = useCallback(
    async (type: string, payload: Record<string, unknown>, done?: string) => {
      setBusy(true);
      const ack = await submitAuctionCommand(slug, commandId(), type, payload);
      setBusy(false);
      if (ack.accepted) {
        if (done !== undefined) {
          toast({ title: done, tone: "success" });
        }
        return true;
      }
      toast({ title: `Rejected: ${ack.reason ?? "unknown"}`, tone: "danger" });
      return false;
    },
    [slug, toast],
  );

  // DA-02: which of my paddles is bidding. A conductor running the night from
  // one laptop holds several; the room used to bind to the first one for ever.
  const [activePaddleId, setActivePaddleId] = useState<string | null>(null);
  const myPaddle =
    view.myPaddles.find((entry) => entry.paddleId === activePaddleId) ?? view.myPaddle;

  const claim = async () => {
    if (await send("ClaimPaddle", { teamId: claimTeam }, "Paddle claimed")) {
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
    if (await send("ReleasePaddle", { teamId }, "Paddle released")) {
      router.refresh();
    }
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
    await send("PlaceBid", { lotId, paddleId: myPaddle.paddleId, amountRaw: amount });
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

  return (
    <div
      className="competitions-stack"
      data-testid="live-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <StatusRibbon snapshot={snapshot} connection={connection} remainingMs={remainingMs} />

      {/* The ribbon above already carries status, connection and version. This
          strip adds only what it does not: progress, clock drift, and the
          read-only warning. It used to repeat all three in a second card. */}
      <div className="live-substatus">
        {snapshot !== null ? (
          <AuctionProgress snapshot={snapshot} />
        ) : (
          <p className="competitions-hint">Waiting for the first snapshot…</p>
        )}
        <span className="live-substatus-meta">
          <ConnectionQuality connection={connection} drift={drift} />
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
              />
              {myPaddle !== null ? (
                <PaddleControl
                  lot={lot}
                  rules={view.rules}
                  snapshot={snapshot}
                  myPaddleNumber={myPaddle.paddleNumber}
                  myTeam={myTeam}
                  squadSigned={mySquadSigned}
                  disabled={readOnly || busy}
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
          <PurseBoard
            snapshot={snapshot}
            teams={view.teams}
            myPaddleNumber={myPaddle?.paddleNumber ?? null}
          />
          <PoolSummary snapshot={snapshot} resolved={feed.resolved} preSigned={view.preSigned} />
        </div>
      </div>

      <SquadBoard
        teams={view.teams}
        preSigned={view.preSigned}
        resolved={feed.resolved}
        snapshot={snapshot}
        squadMax={view.rules.squadMax}
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
              loading={busy}
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
              loading={busy}
              disabled={claimTeam === ""}
              data-testid="claim-paddle"
            >
              Claim paddle
            </Button>
          </div>
        ) : (
          <p className="competitions-hint" data-testid="no-grant-hint">
            No paddle grant yet — accept your owner invitation and ask the organizer to grant your
            paddle.
          </p>
        )}
        {snapshot !== null ? (
          <ul className="conflict-list">
            {snapshot.paddles.map((paddle) => (
              <li key={paddle.paddleId} data-testid={`live-paddle-${paddle.paddleNumber}`}>
                <Badge tone={paddle.released ? "neutral" : "info"}>{paddle.paddleNumber}</Badge>
                <span>{paddle.teamName}</span>
                <span className="registration-phone">
                  purse {formatPaiseINR(paise(paddle.purseRemaining))} · committed{" "}
                  {formatPaiseINR(paise(paddle.committed))}
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
              onClick={() => void send("QueueLots", {}, "Lots queued")}
              loading={busy}
              data-testid="conduct-queue"
            >
              Queue lots
            </Button>
            <Button
              onClick={() =>
                void send("OpenLot", { lotId: snapshot?.queue[0]?.lotId ?? "" }, "Lot opened")
              }
              loading={busy}
              disabled={(snapshot?.queue.length ?? 0) === 0}
              data-testid="conduct-open-lot"
            >
              Open next lot{snapshot?.queue[0] ? ` (${snapshot.queue[0].lotNumber})` : ""}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void send("CloseLot", { lotId: lot?.lotId ?? "" }, "Lot closed")}
              loading={busy}
              disabled={lot === null}
              data-testid="conduct-close-lot"
            >
              Close lot (gavel)
            </Button>
          </div>
          <div className="date-row">
            {snapshot?.auctionStatus === "live" ? (
              <Button
                variant="ghost"
                onClick={() => void send("PauseAuction", {}, "Paused")}
                loading={busy}
                data-testid="conduct-pause"
              >
                Pause
              </Button>
            ) : null}
            {snapshot?.auctionStatus === "paused" ? (
              <Button
                variant="ghost"
                onClick={() => void send("ResumeAuction", {}, "Resumed")}
                loading={busy}
                data-testid="conduct-resume"
              >
                Resume
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => void send("CompleteAuction", {}, "Auction completed")}
              loading={busy}
              data-testid="conduct-complete"
            >
              Close auction
            </Button>
            <Button
              variant="ghost"
              onClick={() => void send("RecoverAuction", {}, "Recovered — state verified")}
              loading={busy}
              data-testid="conduct-recover"
            >
              Recover
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
