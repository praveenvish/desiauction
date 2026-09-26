"use client";

import { roleLabeller } from "../../../../lib/role-label";
import type { AuctionSnapshot, CeremonyState, LotOutcomeKind } from "@desiauction/core";
import { GoldDrift, PlayerImage, SoldStamp, type StampSize } from "@desiauction/ui";
import { useEffect, useMemo, useState } from "react";

import { lotSeed } from "../../../../lib/player-seed";
import type { TeamIdentity } from "./purse-board";
import type { LotMedia, ResolvedLot } from "../../../../server/auction/live-summary";
import { useMoney } from "../../../../components/money-unit";

// The FLOODLIGHT ceremony stage (M-IP4-3). Presentation ONLY: renders the
// deterministic ceremony phase derived from consecutive AuctionSnapshots.
// Transitions key on `ceremony.key` — the same moment renders the same frame
// on every connected surface. Motion collapses to plain state changes under
// prefers-reduced-motion (IP-1 motion grammar, doc 11).

const PHASE_TITLE: Record<CeremonyState["phase"], string> = {
  idle: "",
  opening: "ON THE BLOCK",
  bid: "CURRENT BID",
  extension: "ANTI-SNIPE — TIME EXTENDED",
  hold: "LOT FROZEN",
  sold: "SOLD",
  unsold: "UNSOLD",
  withdrawn: "WITHDRAWN",
  reopened: "UNDONE — BACK ON THE BLOCK",
  paused: "AUCTION PAUSED",
  recovered: "ENGINE RECOVERED — STATE VERIFIED",
  completed: "AUCTION COMPLETE",
};

/**
 * THE BROADCAST VOCABULARY for a lot outcome (DA-20).
 *
 * `lastOutcome.kind` is an engine enum — `held`, `reopened` — and the OBS
 * overlay was printing it raw to air, so a frozen lot went out as "HELD" and an
 * undone sale would have gone out as "REOPENED". This file already owned the
 * human words for exactly these moments; they are exported so the overlay says
 * the same thing the stage does rather than inventing a second dialect.
 */
export const OUTCOME_TITLE: Record<LotOutcomeKind, string> = {
  sold: "SOLD",
  unsold: "UNSOLD",
  withdrawn: "WITHDRAWN",
  held: "LOT FROZEN",
  reopened: "BACK ON THE BLOCK",
};

/**
 * The one-line explanation under an outcome. Non-sold outcomes used to fall
 * back to the auction's own name — the overlay announcing "Nikhil Joshi /
 * Demo Premier League Auction" and telling the audience nothing about what had
 * just happened to him.
 */
export function outcomeMeta(
  outcome: NonNullable<AuctionSnapshot["lastOutcome"]>,
  /**
   * The auction is over. "Back in the pool" is a promise of another round, and
   * once the night has ended there is none: an unsold player is simply unsold.
   */
  finished = false,
): string {
  switch (outcome.kind) {
    case "sold":
      return outcome.teamName === null ? "Sold" : `to ${outcome.teamName}`;
    case "unsold":
      return finished ? "No bids — unsold" : "No bids — back in the pool";
    case "withdrawn":
      return "Withdrawn from the auction";
    case "held":
      return "Clock stopped for the auctioneer";
    case "reopened":
      return "Result undone — bidding reopens";
  }
}

// THE SOLD CEREMONY (doc 11, C-5) — four beats in 1800ms, timed in
// auction.css around the shared theatre primitives: the freeze (a gold flash
// behind the name), the stamp (the gavel strikes, gold SOLD lands with a
// spring), the facts (the price and the buyer roll in), the settle (gold
// recedes to a thin frame). Every layer is deterministic and keyed on
// `ceremony.key`, so the cockpit, the big screen and a phone in the hall play
// the identical moment. Decoration is aria-hidden and gone under reduced
// motion; the static gold frame is the non-motion marker.

/** How many buys the results showcase puts on the stage when the night ends. */
const SHOWCASE = 3;

/** How long a blank stage stays hopeful before it admits it cannot get through. */
const PATIENCE_MS = 8_000;

export function CeremonyStage({
  roles,
  snapshot,
  ceremony,
  remainingMs,
  /**
   * Faces and numbers for every lot, keyed by lot id — the whole record rather
   * than one entry, because this stage follows TWO subjects: the lot on the
   * block and, between lots, the one that just resolved. Both carry a `lotId`,
   * so the stage looks up whichever it is showing.
   *
   * Defaulted to empty so a surface without media still renders: the
   * portrait then falls back to the player's branded mark.
   */
  lotMedia = {},
  /** `stage` when the ceremony fills a projector; `lg` in a page. */
  stampSize = "lg",
  /**
   * The night's settled lots and the franchises that bought them. Used by ONE
   * phase: the finished stage, which used to be 552px of black with "3/3 LOTS
   * RESOLVED" in the middle of it — the last frame of the evening, on the most
   * shared screen in the product, showing nobody. It becomes the night's top
   * buys, with faces. Optional: a surface that has no history still renders.
   */
  resolved = [],
  teams = [],
  serverStatus,
}: {
  /** The season's roles, so a football night is not named in cricket. */
  roles: readonly { key: string; label: string }[];
  snapshot: AuctionSnapshot | null;
  ceremony: CeremonyState;
  remainingMs: number | null;
  /**
   * The auction's status as the page was rendered. Before the room answers,
   * a finished auction shows its result instead of a black "connecting" box —
   * presentation only; the socket is untouched.
   */
  serverStatus?: string;
  lotMedia?: Readonly<Record<string, LotMedia>>;
  stampSize?: StampSize;
  resolved?: readonly ResolvedLot[];
  teams?: readonly TeamIdentity[];
}) {
  const money = useMoney();
  const labelOf = useMemo(() => roleLabeller(roles), [roles]);
  // "Waiting for the first snapshot…" told a guest, in the product's own
  // internals, that something they have no name for has not happened. Eight
  // seconds in it stops being a wait and becomes information: the room may not
  // have opened yet, and we are still trying.
  const [patienceSpent, setPatienceSpent] = useState(false);
  useEffect(() => {
    if (snapshot !== null) {
      return;
    }
    const timer = setTimeout(() => {
      setPatienceSpent(true);
    }, PATIENCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [snapshot]);

  if (snapshot === null) {
    const settled = serverStatus === "completed" || serverStatus === "reconciled";
    const top = settled
      ? [...resolved]
          .filter((entry) => entry.status === "sold")
          .sort((a, b) => (b.soldPrice ?? 0) - (a.soldPrice ?? 0))
          .slice(0, SHOWCASE)
      : [];
    if (top.length > 0) {
      /* A finished night does not need the room to say how it ended: the
         result is already on the page, so it leads while the socket connects. */
      return (
        <section
          className="ceremony ceremony-completed"
          data-testid="ceremony"
          data-phase="completed"
        >
          <p className="ceremony-title" data-testid="ceremony-title">
            {PHASE_TITLE.completed}
          </p>
          <div className="ceremony-lot ceremony-waiting" data-testid="ceremony-finished">
            <Showcase
              entries={top}
              lotMedia={lotMedia}
              colorOf={(teamName) =>
                teams.find((team) => team.name === teamName)?.primaryColor ?? undefined
              }
              ledger={money.ledger}
            />
            <p className="ceremony-waiting-hint">Every lot is settled. Final squads below.</p>
          </div>
        </section>
      );
    }
    /* Anything else: the stage's own shape as a quiet skeleton, not a black box. */
    return (
      <section
        className="ceremony ceremony-idle ceremony-skeleton"
        data-testid="ceremony"
        data-phase="connecting"
      >
        <span className="ceremony-skel ceremony-skel-face" aria-hidden />
        <span className="ceremony-skel ceremony-skel-line" aria-hidden />
        <span className="ceremony-skel ceremony-skel-line ceremony-skel-short" aria-hidden />
        <p className="ceremony-waiting-hint">
          {patienceSpent ? "Not connected" : "Connecting to the auction room…"}
        </p>
        {patienceSpent ? (
          <p className="ceremony-waiting-hint" data-testid="ceremony-unreachable">
            Can&apos;t reach the auction room. It may not have started yet — we&apos;ll keep trying.
          </p>
        ) : null}
      </section>
    );
  }
  const lot = snapshot.currentLot;
  const outcome = snapshot.lastOutcome;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  // The auction is OVER. Everything below this line — "Between lots", "The next
  // lot is coming up" — describes an interval before a next lot that will never
  // come, and it used to render directly beneath a ribbon reading COMPLETED and
  // a title reading AUCTION COMPLETE, in 44px display type.
  const finished =
    snapshot.auctionStatus === "completed" ||
    snapshot.auctionStatus === "reconciled" ||
    snapshot.auctionStatus === "abandoned";
  /**
   * THE FACE OF WHOEVER THE STAGE IS ABOUT.
   *
   * A lot on the block owns the stage; between lots the last outcome does. The
   * finished state is about the auction rather than a person, so it takes no
   * face at all.
   */
  const showcase = finished
    ? [...resolved]
        .filter((entry) => entry.status === "sold")
        .sort((a, b) => (b.soldPrice ?? 0) - (a.soldPrice ?? 0))
        .slice(0, SHOWCASE)
    : [];
  const colorOf = (teamName: string | null): string | undefined =>
    teams.find((team) => team.name === teamName)?.primaryColor ?? undefined;
  const subject = finished ? null : (lot?.lotId ?? outcome?.lotId ?? null);
  const media = subject === null ? undefined : lotMedia[subject];
  const photo = media?.photoUrl ?? null;
  const number = media?.number ?? null;
  /**
   * THE PORTRAIT. The backdrop alone put a face on the stage only when a photo
   * existed, and only as a wash behind the name — a player without a photo had
   * no face at all, and one with a photo was never actually SHOWN. The portrait
   * is the player's photo or their branded mark, in a box the stage reserves
   * (`.ceremony-portrait`, counted into the stage's measured height), so the
   * face never resizes the stage. Decorative: the name sits directly under it
   * in display type.
   */
  const portrait =
    subject === null ? null : (
      <span className="ceremony-portrait" data-testid="ceremony-portrait">
        <PlayerImage
          name={lot?.playerName ?? outcome?.playerName ?? "Unnamed"}
          seed={lotSeed(subject, lotMedia)}
          src={photo}
          size="hero"
          shape="round"
          fluid
          decorative
        />
      </span>
    );

  return (
    <section
      key={ceremony.key}
      className={`ceremony ceremony-${ceremony.phase}`}
      data-testid="ceremony"
      data-phase={ceremony.phase}
    >
      {/* THE PHOTO GOES BEHIND THE NAME, NOT ABOVE IT.
          The stage's height is a measured contract (see `.ceremony` in
          auction.css): every phase has to occupy the same box, or the live room
          moves under it on every single sale — that was CLS 0.444 the last time
          the phases disagreed. A row for a face would reopen exactly that, and
          on the biggest phase. A backdrop costs the stage no height at all, and
          a lot whose player never consented to a photo (DPDP §5) simply renders
          the stage this file always drew.
          Decorative: the player's name is announced in display type an inch
          above it, so the image says nothing a reader is not already told. */}
      {photo === null ? null : (
        <span className="ceremony-backdrop" aria-hidden="true">
          {/* Decoded off the main thread, so a large upload cannot stall the
              SOLD beat; the intrinsic size only reserves a box — the CSS
              fills the stage. */}
          <img src={photo} alt="" width={640} height={640} decoding="async" />
        </span>
      )}
      {ceremony.phase === "sold" ? (
        <div className="ceremony-celebration" aria-hidden="true">
          <span className="ceremony-glow" />
          <GoldDrift className="ceremony-drift" />
        </div>
      ) : null}
      {/* The two verdicts are STAMPED, not titled: the word arrives as an
          object with weight (SOLD struck by the gavel in gold; UNSOLD in
          neutral ink, brisk, C-23). Every other phase keeps its title line. */}
      {ceremony.phase === "sold" || ceremony.phase === "unsold" ? (
        <p className="ceremony-title ceremony-title--stamp" data-testid="ceremony-title">
          <SoldStamp tone={ceremony.phase} size={stampSize} />
        </p>
      ) : (
        <p className="ceremony-title" data-testid="ceremony-title">
          {PHASE_TITLE[ceremony.phase]}
        </p>
      )}
      {finished ? (
        <div className="ceremony-lot ceremony-waiting" data-testid="ceremony-finished">
          {/* The figure in display type, the words in the text face: "37/37
              LOTS RESOLVED" as one display line broke into three on a phone. */}
          <p
            className="ceremony-waiting-title ceremony-finished-count"
            data-testid="ceremony-progress"
          >
            {snapshot.lotsResolved}/{snapshot.lotsTotal}{" "}
            <span className="ceremony-finished-words">lots resolved</span>
          </p>
          {showcase.length > 0 ? (
            /* THE NIGHT'S HEADLINES — the biggest buys, by face, each ringed in
               the colours of the franchise that won them. */
            <Showcase
              entries={showcase}
              lotMedia={lotMedia}
              colorOf={colorOf}
              ledger={money.ledger}
            />
          ) : null}
          <p className="ceremony-waiting-hint">Every lot is settled. Final squads below.</p>
        </div>
      ) : lot !== null ? (
        /* `ceremony-reveal`: a new lot enters line by line — name, then meta,
           then money, then the clock — 60ms apart. The section is keyed on the
           moment, so the reveal plays once per lot and never on a bid. */
        <div className={`ceremony-lot${ceremony.phase === "opening" ? " ceremony-reveal" : ""}`}>
          {portrait}
          <h2 className="ceremony-player" data-testid="ceremony-player">
            {lot.playerName ?? "Unnamed"}
          </h2>
          {/* The player's REGISTRATION number rides inside the meta line rather
              than on one of its own — same reason as the backdrop above: this
              stage may not grow a row. `lotNumber` stays beside it because the
              two answer different questions ("where in tonight's order" versus
              "which player"), and the auctioneer calls both. */}
          <p className="ceremony-meta">
            {/* The separating space belongs to the badge, not to the line: left
                outside the branch it survives a player with no number and pads
                the centred line by a character. */}
            {number === null ? null : (
              <>
                <span className="ceremony-number" data-testid="ceremony-player-number">
                  #{number}
                </span>{" "}
              </>
            )}
            {lot.lotNumber} · {labelOf(lot.role)} · base {money.ledger(lot.basePrice)}
          </p>
          {lot.currentBid !== null ? (
            <p className="ceremony-bid" data-testid="ceremony-bid">
              {money.ledger(lot.currentBid.amount)}
              <span className="ceremony-leader" data-testid="ceremony-leader">
                {lot.currentBid.teamName} · {lot.currentBid.paddleNumber}
              </span>
            </p>
          ) : (
            <p className="ceremony-bid ceremony-bid-open">
              Opening at {money.ledger(lot.nextMinimumBid)}
            </p>
          )}
          {ceremony.phase === "paused" ? (
            <p className="ceremony-frozen" data-testid="ceremony-frozen">
              The clock is stopped. Bidding resumes when the auctioneer restarts it.
            </p>
          ) : seconds !== null ? (
            <p
              className={`ceremony-timer${seconds <= 15 ? " ceremony-timer-hot" : ""}`}
              data-testid="ceremony-timer"
            >
              {seconds}s{lot.extensions > 0 ? ` · extended ×${String(lot.extensions)}` : ""}
            </p>
          ) : null}
        </div>
      ) : outcome !== null ? (
        /* The big screen for a frozen or undone lot used to be two words and a
           name: 28px "LOT FROZEN" over a 129px player, with the price, the
           clock and any explanation all suppressed, because a price rendered
           only for `sold`. Every phase has a price worth showing (the money the
           lot had reached) and a reason worth naming. */
        <div className="ceremony-lot">
          {portrait}
          <h2 className="ceremony-player" data-testid="ceremony-player">
            {outcome.playerName ?? outcome.lotNumber}
          </h2>
          {outcome.amount !== null ? (
            <p className="ceremony-bid" data-testid="ceremony-bid">
              {money.ledger(outcome.amount)}
              {outcome.kind === "sold" ? (
                /* Beat three's second fact. "Sold to" is its own small line so
                   the franchise name below it can be set at display size — the
                   hall reads WHO before it reads how much. */
                <span
                  className="ceremony-leader ceremony-leader--sold"
                  data-testid="ceremony-leader"
                >
                  <span className="ceremony-leader-kicker">Sold to</span>
                  {[outcome.teamName, outcome.paddleNumber]
                    .filter((part): part is string => part !== null && part !== "")
                    .join(" · ")}
                </span>
              ) : null}
            </p>
          ) : null}
          {/* The number again on the outcome splash: the same person is still on
              the big screen, and this is the line that names what happened to
              them. Inline, for the same height reason as above. */}
          <p className="ceremony-frozen" data-testid="ceremony-outcome-reason">
            {number === null ? null : (
              <>
                <span className="ceremony-number" data-testid="ceremony-player-number">
                  #{number}
                </span>{" "}
              </>
            )}
            {/* The buyer is already named in display type above on a sale;
                repeating "to Strikers" here said it twice. The queue position
                is the fact that line has left to give. */}
            {outcome.kind === "sold" ? outcome.lotNumber : outcomeMeta(outcome, finished)}
          </p>
        </div>
      ) : (
        <div className="ceremony-lot ceremony-waiting">
          <span className="ceremony-waiting-dot" aria-hidden />
          <p className="ceremony-waiting-title">
            {snapshot.lotsResolved === 0 ? "Ready" : "Between lots"}
          </p>
          <p className="ceremony-meta" data-testid="ceremony-progress">
            {snapshot.lotsResolved}/{snapshot.lotsTotal} lots resolved
          </p>
          <p className="ceremony-waiting-hint">
            {/* This read "0 players in the queue" on the pre-auction stage —
                under "0/2 lots resolved", on a night with two players to sell.
                `queue` is what the ENGINE has loaded, which is empty until the
                auction opens; `lotsTotal` is the promise the evening actually
                makes. */}
            {snapshot.lotsResolved === 0
              ? snapshot.lotsTotal > 0
                ? `Doors open. ${String(snapshot.lotsTotal)} ${
                    snapshot.lotsTotal === 1 ? "player goes" : "players go"
                  } under the hammer tonight.`
                : "Waiting for the auctioneer to open the first lot."
              : "The next lot is coming up"}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * THE NIGHT'S HEADLINES — the biggest buys, by face, each ringed in the colours
 * of the franchise that won them. Shared by the finished phase and by the
 * stage a guest sees before the room answers on a finished auction.
 */
function Showcase({
  entries,
  lotMedia,
  colorOf,
  ledger,
}: {
  entries: readonly ResolvedLot[];
  lotMedia: Readonly<Record<string, LotMedia>>;
  colorOf: (teamName: string | null) => string | undefined;
  ledger: (amount: number) => string;
}) {
  return (
    <ol className="ceremony-showcase" data-testid="ceremony-showcase">
      {entries.map((entry, index) => (
        <li key={entry.lotId} className="ceremony-showcase-item">
          <span className="ceremony-showcase-face">
            <PlayerImage
              name={entry.playerName ?? entry.lotNumber}
              seed={entry.registrationId ?? lotSeed(entry.lotId, lotMedia)}
              src={lotMedia[entry.lotId]?.photoUrl ?? null}
              size="hero"
              shape="round"
              fluid
              decorative
              teamColor={colorOf(entry.teamName)}
              ring
            />
          </span>
          <span className="ceremony-showcase-rank">
            {index === 0 ? "Top buy" : `#${String(index + 1)}`}
          </span>
          <b className="ceremony-showcase-name">{entry.playerName ?? entry.lotNumber}</b>
          <span className="ceremony-showcase-price">{ledger(entry.soldPrice ?? 0)}</span>
          <span className="ceremony-showcase-team">{entry.teamName ?? "—"}</span>
        </li>
      ))}
    </ol>
  );
}
