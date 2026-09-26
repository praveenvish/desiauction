"use client";

import { commandRefusalMessage } from "@desiauction/core";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  IconClock,
  IconGavel,
  IconHome,
  IconUser,
  IconUsers,
  IconWallet,
  Select,
  TeamChip,
  useToast,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  submitAuctionCommand,
  type LiveAuctionView,
} from "../../../../../server/auction/live-actions";
import { CeremonyStage } from "../ceremony-stage";
import { useIntentIds } from "../use-intent-ids";
import {
  AuctionProgress,
  AuctionSummaryCard,
  AuctionTimeline,
  BidFeedList,
  ConnectionQuality,
  MyTeamCard,
  useLiveFeed,
} from "../live-experience";
import { PageStatus } from "../../../../../components/shell/page-status";
import { AuctionAnnouncer } from "../auction-announcer";
import { GavelButton } from "../cockpit/gavel-button";
import { LotHero } from "../lot-hero";
import { PaddleControl } from "../paddle-control";
import { evaluateLivePlan, planNameOf } from "../plan-live";
import { PurseBoard } from "../purse-board";
import { PoolSummary, SquadBoard, squadSizesOf } from "../squad-board";
import { StatusRibbon } from "../status-ribbon";
import { useAuctionSocket } from "../use-auction-socket";
import { useCeremonySound } from "../use-ceremony-sound";
import { useHydrated } from "../../../../../lib/use-hydrated";
import "./live.css";
import { useMoney } from "../../../../../components/money-unit";

// The live client (M-IP4-2, rewired M-IP4-3). This component DECIDES NOTHING:
// it renders the broadcast AuctionSnapshot (shared socket hook), sends
// commands, and shows acknowledgements. Claims are grant-gated: only teams
// this person holds a paddle grant for are claimable (the production owner
// model) — and the engine enforces it regardless.

const AUCTION_TONE = {
  scheduled: "neutral",
  live: "success",
  paused: "warning",
  completed: "success",
  reconciled: "success",
  abandoned: "danger",
} as const;

/** The room's in-page map (founder mockup 5) — anchors, wide screens only. */
const ROOM_NAV = [
  { href: "#live-top", label: "Overview", icon: <IconHome size={18} /> },
  { href: "#live-stage", label: "Live auction", icon: <IconGavel size={18} /> },
  { href: "#live-squads", label: "Squads", icon: <IconUsers size={18} /> },
  { href: "#live-pool", label: "Players", icon: <IconUser size={18} /> },
  { href: "#live-purses", label: "Purses", icon: <IconWallet size={18} /> },
  { href: "#live-timeline", label: "Timeline", icon: <IconClock size={18} /> },
];

export function LivePanel({
  slug,
  view,
  exits,
}: {
  slug: string;
  view: LiveAuctionView;
  /** The doors to the other auction views, drawn in the room's bottom bar. */
  exits?: ReactNode;
}) {
  const money = useMoney();
  const router = useRouter();
  const toast = useToast();
  const { snapshot, connection, remainingMs, version, ceremony, drift, stale, offline, clock } =
    useAuctionSocket(view.wsUrl);
  const feed = useLiveFeed(view.resolved, snapshot);
  useCeremonySound({ ceremony, remainingMs, lotId: snapshot?.currentLot?.lotId ?? null });
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
  const intents = useIntentIds();
  const hydrated = useHydrated();

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
        // Reuses this intent's id if a previous attempt ended without an answer,
        // so the retry is de-duplicated by the engine instead of re-executed.
        //
        // THE PAYLOAD IS PART OF THE KEY, and leaving it out was the defect
        // (audit PA-1 §6). `useIntentIds` has always supported payload-keyed
        // slots and its comment explains precisely why they are needed — but
        // both calls here passed the control name alone, so every bid shared
        // one slot called "bid". After a lost answer that slot survives, and the
        // next press — a different amount, or the NEXT LOT — arrived carrying
        // the previous id. The engine, correctly, returned the cached ack for
        // the earlier command. The bidder was told "accepted" for a bid that
        // never landed, on a player they did not buy.
        ack = await submitAuctionCommand(slug, intents.idFor(key, payload), type, payload);
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
      // An ack — accepted OR refused — is a definitive answer, so this intent is
      // over and the next press starts a new one. Settled by the same
      // (control, payload) slot it was minted under, or the entry leaks and the
      // slot is never reused for an identical retry.
      intents.settle(key, payload);
      if (ack.accepted) {
        if (done !== undefined) {
          toast({ title: done, tone: "success" });
        }
        return true;
      }
      toast({ title: commandRefusalMessage(ack.reason), tone: "danger" });
      return false;
    },
    [slug, toast, intents],
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
      // The claim form sits at the foot of the room and the paddle at its
      // head: on a phone the owner was left ~2,000px below the Raise button.
      bringBiddingIntoView("top");
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
      // Same intent discipline as `send`: closing the night twice because the
      // first answer was lost is exactly the mistake the engine can prevent, but
      // only if the retry carries the id the first attempt used.
      //
      // KEYED ON THE PAYLOAD, for the reason the comment below the call already
      // gives and this line used to defeat. Settling on any answer handles a
      // refusal; it cannot handle a LOST one. With the payload omitted, an
      // unanswered plain close left its slot occupied, and the conductor's next
      // attempt — the one carrying the override — inherited that id and was
      // handed the cached `squad_below_minimum` refusal. The override could
      // never take effect and the night could not be closed from this panel.
      ack = await submitAuctionCommand(
        slug,
        intents.idFor("complete", payload),
        "CompleteAuction",
        payload,
      );
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
    /*
     * An ack ends the intent — and here that matters twice over. A refusal for
     * `squad_below_minimum` sends the conductor back into the dialog to record
     * an override, and the command they then send carries a DIFFERENT payload.
     * Reusing the id for it would hand back the cached refusal and the override
     * could never take effect, so the slot is cleared on any answer, not just a
     * successful one.
     */
    intents.settle("complete", payload);
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
    // The button's `disabled` is the only thing that stopped a second tap, and
    // it arrives a render late: `setPending` is asynchronous, so two taps inside
    // one frame both got here. Guarding on the in-flight key closes that window
    // in the click handler itself rather than relying on React having repainted.
    if (bidBusy) {
      return;
    }
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
        title: `Outbid — ${snapshot.currentLot?.currentBid?.teamName ?? "another team"}${amount !== undefined ? ` at ${money.ledger(amount)}` : ""}`,
        tone: "info",
        // One slot for "where do I stand on this lot": the newest price only.
        group: "bid-status",
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
        title: `You signed ${outcome.playerName ?? outcome.lotNumber}${outcome.amount !== null ? ` for ${money.ledger(outcome.amount)}` : ""}!`,
        tone: "success",
        group: "bid-status",
      });
    }
  }, [snapshot, myPaddle, toast, money]);

  const lot = snapshot?.currentLot ?? null;

  // Every new lot is a fresh decision for a bidder. An owner who scrolled
  // down to read the squads was not shown the next player going up; bring
  // the lot back into view — only for paddle holders, only when it changes.
  const lotId = lot?.lotId ?? null;
  const holdsPaddle = myPaddle !== null;
  useEffect(() => {
    if (lotId !== null && holdsPaddle) {
      bringBiddingIntoView("lot");
    }
  }, [lotId, holdsPaddle]);
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
  // Squad sizes counted the way the ENGINE counts them — auction buys PLUS
  // pre-signed players (aggregate.ts:835) — so every ceiling drawn from them is
  // the amount the engine will actually accept.
  const squadSizes = squadSizesOf(view.teams, view.preSigned, feed.resolved);
  const teamColors = Object.fromEntries(view.teams.map((team) => [team.id, team.primaryColor]));
  const colorOfTeamName = new Map(view.teams.map((team) => [team.name, team.primaryColor]));
  /*
   * THE RAISE BUTTON COUNTS THE SAME SQUAD THE ENGINE DOES.
   *
   * This was auction buys only, so on any competition with icons or retained
   * players the button believed the squad was smaller than it is — and a
   * smaller squad means a HIGHER affordable ceiling, because less must be held
   * back to fill the minimum. The button therefore offered raises the gauntlet
   * would refuse: the same defect class as "the raise button ignores the
   * bidder's purse" (RH-1 D-008), surviving in the one input that fix did not
   * touch. It also disagreed with the "Max bid" now printed on the purse board
   * beside it, which already counted the engine's way.
   */
  const mySquadSigned = myPaddle === null ? 0 : (squadSizes[myPaddle.teamId] ?? 0);
  // WR-1: the owner's plan, folded against THIS frame with the same squad and
  // purse the raise button uses. Null for everyone who has none — and the
  // payload never carried a rival's, so there is nothing here to hide.
  const planState =
    view.plan === undefined || myPaddle === null
      ? null
      : evaluateLivePlan(view.plan, myPaddle.teamId, snapshot, feed.resolved, mySquadSigned);
  const planNames = (registrationId: string) =>
    view.plan === undefined ? "a player" : planNameOf(view.plan, registrationId);
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
          lotMedia={view.lotMedia}
        />
      </PageStatus>

      {readOnly && snapshot !== null ? (
        <p role="alert" className="live-readonly" data-testid="readonly-banner">
          Reconnecting — you&apos;re seeing the last known state; bidding is disabled until
          we&apos;re live again.
        </p>
      ) : null}

      <div className="live-layout">
        {/* The room's map: anchors into this one page, on screens wide enough
            to give it a column. A phone scrolls; it never sees this rail. */}
        <nav className="live-roomnav" aria-label="In this room">
          <ul>
            {/* The timeline and pool cards stand down once the night is over,
                so their anchors do too. */}
            {ROOM_NAV.filter(
              (item) => !finished || (item.href !== "#live-timeline" && item.href !== "#live-pool"),
            ).map((item) => (
              <li key={item.href}>
                <a href={item.href}>
                  {item.icon}
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          {/* The floating "Great auction!" rail card is gone: the wrap band
              above the room already says it, and the card hung alone halfway
              down an otherwise empty rail. */}
        </nav>

        <div className="live-main" id="live-top">
          {snapshot !== null && snapshot.auctionStatus === "completed" ? (
            <AuctionSummaryCard
              snapshot={snapshot}
              feed={feed}
              slug={slug}
              canConduct={view.viewer.canConduct}
              viewerTeamName={myPaddle?.teamName ?? null}
              teamColors={teamColors}
            />
          ) : null}

          {/* Two columns, as the Owner Room comp has it: the lot and the paddle
              on the left where the eye lives, the board on the right. */}
          <div className="live-grid">
            <div className="live-col" id="live-stage">
              {lot !== null ? (
                <>
                  <LotHero
                    roles={view.roles}
                    lot={lot}
                    remainingMs={remainingMs}
                    lotDurationMs={lotDurationMs}
                    leadColor={leadColor}
                    frozen={notTakingBids}
                    clock={clock}
                    media={view.lotMedia[lot.lotId]}
                  />
                  {myPaddle !== null ? (
                    <PaddleControl
                      lot={lot}
                      rules={view.rules}
                      snapshot={snapshot}
                      myPaddleNumber={myPaddle.paddleNumber}
                      myTeam={myTeam}
                      squadSigned={mySquadSigned}
                      plan={planState}
                      planNames={planNames}
                      disabled={readOnly || bidBusy}
                      onBid={(amount) => {
                        void bid(amount);
                      }}
                    />
                  ) : null}
                </>
              ) : (
                /* Between lots the owner sees exactly what the room sees. */
                <CeremonyStage
                  roles={view.roles}
                  snapshot={snapshot}
                  ceremony={ceremony}
                  remainingMs={remainingMs}
                  lotMedia={view.lotMedia}
                  resolved={feed.resolved}
                  teams={view.teams}
                />
              )}

              {/* A finished room has no bids to feed: the card used to say
                  "Bids appear here once a lot opens" under a completed night. */}
              {finished ? null : (
                <Card data-testid="bid-feed" className="live-card">
                  <div className="competition-head">
                    <h2>Bid feed</h2>
                    {/* "Live" is a claim about the AUCTION, not the socket: a
                      finished room keeps its connection open, and the pill
                      used to glow green over a completed night. */}
                    {connection === "open" && snapshot?.auctionStatus === "live" ? (
                      <span className="live-feed-live">
                        <span className="live-pulse" aria-hidden />
                        Live
                      </span>
                    ) : null}
                  </div>
                  {lot === null || lot.bidHistory.length === 0 ? (
                    <p className="competitions-hint" data-testid="bid-feed-empty">
                      {lot === null
                        ? "Bids appear here once a lot opens."
                        : "Bids will appear here the moment they land."}
                    </p>
                  ) : (
                    <BidFeedList
                      bids={lot.bidHistory}
                      playerName={lot.playerName}
                      teamColors={colorOfTeamName}
                      testId="bid-history"
                    />
                  )}
                </Card>
              )}

              {/* Once the night is over the timeline held one row ("passes for
                  now"); the summary's "Watch the replay" is the full story. */}
              {finished ? null : (
                <div id="live-timeline" className="live-anchor">
                  <AuctionTimeline
                    feed={feed}
                    lotMedia={view.lotMedia}
                    teamColors={new Map(view.teams.map((team) => [team.name, team.primaryColor]))}
                  />
                </div>
              )}
            </div>

            <div className="live-col">
              {/* The owner workspace exists from the moment the paddle is
                  claimed — lot or no lot. Bidding (PaddleControl, left) comes
                  and goes with the lot; "what have I got and what can I spend"
                  does not. */}
              {myPaddle !== null ? (
                <MyTeamCard
                  snapshot={snapshot}
                  myTeamId={myPaddle.teamId}
                  myTeamName={myPaddle.teamName}
                  myPaddleNumber={myPaddle.paddleNumber}
                  rules={view.rules}
                  feed={feed}
                  squadSize={squadSizes[myPaddle.teamId] ?? 0}
                  plan={planState}
                  lotMedia={view.lotMedia}
                />
              ) : null}
              {/* Unconditional now: AuctionProgress renders its own connecting
                  state, and the guard here was what made the column re-flow when
                  the socket answered — this component sits above the purse
                  board, the pool summary and the squad board, so its arrival
                  moved all three. */}
              {finished ? null : <AuctionProgress snapshot={snapshot} />}
              {/* THE SEAL. A bidder sees their own purse and committed spend,
                  the lot on the block and the public bid feed — not every
                  rival's remaining money. Decided on the server
                  (`viewer.canSeeAllPurses`) and obeyed here; the conductor's
                  board is unchanged. */}
              <div id="live-purses" className="live-anchor">
                <PurseBoard
                  snapshot={snapshot}
                  teams={view.teams}
                  myPaddleNumber={myPaddle?.paddleNumber ?? null}
                  visibleTeamIds={view.viewer.canSeeAllPurses ? null : view.myTeamIds}
                  heading={view.viewer.canSeeAllPurses ? "Purses" : "Your purse"}
                  rules={view.rules}
                  squadSizes={squadSizes}
                  note={
                    view.viewer.canSeeAllPurses
                      ? null
                      : "Rivals' remaining purses are sealed — you see your own."
                  }
                />
              </div>
              {/* Sold / passed / spend / top buy are the summary's tiles once the
                  night is over — a second copy here said them all again. */}
              {finished ? null : (
                <div id="live-pool" className="live-anchor">
                  <PoolSummary
                    snapshot={snapshot}
                    resolved={feed.resolved}
                    preSigned={view.preSigned}
                  />
                </div>
              )}
            </div>
          </div>

          {/* THE ROOM'S CONTROLS BEFORE ITS RECORD (round 3C): Conduct sat
              under three full squads — y≈2900 on a laptop, the end of a
              13,000px phone page. It follows the stage now, and on a phone a
              conductor's card leads the room (live.css). Position only: the
              gavel inside keeps its size, label and hold behaviour. */}
          <div className="live-controls" data-conduct={view.viewer.canConduct ? "true" : "false"}>
            {/* The claim door. Once a paddle is held, PaddleControl above owns
                the "Your paddle" heading and states the same fact in its header,
                so this card would be a second panel of the same name saying the
                same thing.
                Once the night is over there is nothing left to claim: an
                organizer with no paddle used to be told "Claim your paddle — No
                paddle grant yet" on a finished room. A held paddle is gone too:
                there is nothing left to hand back, and the owner's final account
                is the My-team card and the squads below. */}
            {/* An organizer with no paddle grant and no team was told to "ask
                the organizer" — themselves. A conductor who could only ever
                read that sentence gets the Conduct card on its own (round 2). */}
            {finished ||
            (myPaddle === null &&
              grantedTeams.length === 0 &&
              view.myTeamIds.length === 0 &&
              view.viewer.canConduct) ? null : (
              <Card data-testid="paddle-panel" className="live-card">
                <h2>{myPaddle !== null ? "Paddle status" : "Claim your paddle"}</h2>
                {myPaddle !== null ? (
                  <div className="paddle-status-row">
                    <p className="paddle-status-current">
                      <span className="paddle-status-caption">Current paddle</span>
                      <span data-testid="my-paddle" className="registration-name">
                        {myPaddle.paddleNumber} · bidding for {myPaddle.teamName}
                      </span>
                    </p>
                    {/* Holding several paddles is legitimate — one laptop, one
                      auctioneer, a small club. What was missing is the way to
                      say which one is bidding right now. */}
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
                   "accept your owner invitation" — the act they had just
                   completed to get to this page. They are in this room
                   precisely BECAUSE they accepted (`myTeamIds` is non-empty for
                   anyone who did), so the only thing left to say is the one
                   thing they can't do themselves. */
                  <p className="competitions-hint" data-testid="no-grant-hint">
                    {view.myTeamIds.length > 0
                      ? "You're the owner — but a paddle is a separate step. Ask the organizer to grant your paddle; you'll be able to claim it here the moment they do."
                      : "No paddle grant yet — ask the organizer to grant your paddle."}
                  </p>
                )}
                {snapshot !== null ? (
                  <ul className="paddle-chips">
                    {snapshot.paddles.map((paddle) => {
                      const mineEntry = view.myPaddles.find(
                        (entry) => entry.paddleId === paddle.paddleId,
                      );
                      const active = myPaddle?.paddleId === paddle.paddleId;
                      const body = (
                        <>
                          <span className="paddle-chip-head">
                            <TeamChip color={teamColors[paddle.teamId] ?? null}>
                              {paddle.paddleNumber}
                            </TeamChip>
                            <span className="paddle-chip-team">{paddle.teamName}</span>
                          </span>
                          <span className="paddle-chip-money">
                            {paddle.purseRemaining === null || paddle.committed === null
                              ? "purse sealed"
                              : `purse ${money.ledger(paddle.purseRemaining)} · committed ${money.ledger(paddle.committed)}`}
                            {paddle.released ? " · released" : ""}
                          </span>
                        </>
                      );
                      return (
                        <li
                          key={paddle.paddleId}
                          data-testid={`live-paddle-${paddle.paddleNumber}`}
                          data-released={paddle.released ? "true" : undefined}
                        >
                          {/* One of MY paddles is a switch; anyone else's is a fact. */}
                          {mineEntry !== undefined && view.myPaddles.length > 1 ? (
                            <button
                              type="button"
                              className="paddle-chip"
                              aria-pressed={active}
                              onClick={() => {
                                setActivePaddleId(mineEntry.paddleId);
                              }}
                            >
                              {body}
                            </button>
                          ) : (
                            <span className="paddle-chip" data-active={active ? "true" : undefined}>
                              {body}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </Card>
            )}

            {/* Conducting ends with the auction. The card used to stay up on a
                completed room — Queue lots, a gold "Open next lot", a gavel —
                every one of them a button with nothing left to act on. */}
            {view.viewer.canConduct && !finished ? (
              <Card data-testid="conduct-panel" className="live-card">
                <h2>Conduct</h2>
                <div className="conduct-row">
                  <Button
                    variant="secondary"
                    onClick={() => void send("queue", "QueueLots", {}, "Lots queued")}
                    loading={pending === "queue"}
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
                  {/* v1.1 G2: closing a lot is a HOLD, not a click — the same
                      gate the cockpit has had all along. This panel was the one
                      place in the product where the gavel was still a single
                      tap, so the rule the cockpit enforces could be walked
                      around by opening /live. */}
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
                <div className="conduct-row conduct-row--quiet">
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
                  {/* A finished auction cannot be completed, undone or
                      recovered — the whole card is gone once it is over. */}
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
                </div>
              </Card>
            ) : null}
          </div>

          <div id="live-squads" className="live-anchor">
            <SquadBoard
              roles={view.roles}
              teams={boardTeams}
              lotMedia={view.lotMedia}
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
          </div>

          {/* THE ROOM'S BOTTOM BAR: the doors to the other views on the left,
              and — the only place raw transport words appear — the feed
              diagnostics on the right. The strip used to sit ABOVE the lot,
              restating `live`, `open`, a version and a drift figure that the
              ribbon already says in the room's own language. */}
          <div className="live-bottombar">
            {exits}
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
                {/* The raw socket word ("open") read like a status of the
                    AUCTION — it sat beside COMPLETED as "OPEN". Say what it is
                    about: the link to the room. The raw value stays on
                    data-connection for anything that needs to tell
                    "connecting" from "reconnecting". */}
                <Badge
                  tone={connection === "open" ? "success" : "warning"}
                  data-testid="connection-state"
                  data-connection={connection}
                >
                  {connection === "open" ? "Connected" : "Reconnecting"}
                </Badge>
              </span>
            </div>
          </div>
        </div>
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

/** Scroll the bidding area into view, if it is not already; instant under reduced motion. */
function bringBiddingIntoView(target: "top" | "lot"): void {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  if (target === "top") {
    window.scrollTo({ top: 0, behavior });
    return;
  }
  const hero = document.querySelector('[data-testid="current-lot"]');
  if (hero === null) {
    return;
  }
  // Scroll when the lot OR the Raise button under it is cut off: on a phone
  // the lot could be on screen with Raise a few pixels below the fold.
  const raise = document.querySelector('[data-testid="bid-next"]');
  const heroBox = hero.getBoundingClientRect();
  const raiseBottom = raise?.getBoundingClientRect().bottom ?? heroBox.bottom;
  if (heroBox.top < 0 || raiseBottom > window.innerHeight) {
    hero.scrollIntoView({ behavior, block: "start" });
  }
}
