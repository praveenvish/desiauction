"use client";

import { maxAffordableBid, type AuctionSnapshot, type CeremonyState } from "@desiauction/core";
import {
  IconGavel,
  IconKebab,
  IconLock,
  IconPause,
  IconPlay,
  PlayerPortrait,
} from "@desiauction/ui";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";

import { COCKPIT_SHORTCUTS } from "../../../../../components/auction/cockpit-keys";
import {
  deskActionWords,
  gavelResetKey,
  isGavelAction,
  type DeskAction,
} from "../../../../../components/auction/desk-action";
import { useMoney, useMoneyUnit } from "../../../../../components/money-unit";
import { cardAmount } from "../../../../../lib/money";
import { lotSeed } from "../../../../../lib/player-seed";
import { roleLabeller } from "../../../../../lib/role-label";
import type { AuctionRules, LotMedia } from "../../../../../server/auction/live-summary";
import { CeremonyStage, OUTCOME_TITLE } from "../ceremony-stage";
import { BidFeedList } from "../live-experience";
import { LotCard, LotPrice } from "../lot-card";
import { PurseTeamCrest, type TeamIdentity } from "../purse-board";
import type { AuctionClock } from "../use-auction-socket";
import { GavelButton, type GavelHandle } from "./gavel-button";

// THE CONDUCTOR'S DESK (live-room stage 2). The cockpit rebuilt around one
// question — what does the room need from me next? — with the answer on ONE
// button that names it. On a phone that button sits in a bar under the thumb;
// on a laptop it is the centre of three columns: the player card, the price
// with the gavel, and the room (paddles, up next).
//
// Presentation only. Every control calls back into CockpitPanel, which owns
// the commands exactly as before; the gavel is the same hold gate.

type Lot = NonNullable<AuctionSnapshot["currentLot"]>;
type Outcome = NonNullable<AuctionSnapshot["lastOutcome"]>;
type QueueEntry = AuctionSnapshot["queue"][number];

export interface DeskControls {
  /** The primary act when it is a click (open next, open, queue, resume, complete). */
  primary: () => void;
  /** Closing the lot — reached only through the gavel's hold. */
  gavel: () => void;
  pause: () => void;
  freeze: () => void;
  undo: () => void;
  recover: () => void;
  complete: () => void;
  queueLots: () => void;
}

/** The pending key each primary act is sent under (CockpitPanel's `send` keys). */
const PENDING_KEY: Partial<Record<DeskAction["kind"], string>> = {
  "queue-lots": "queue",
  "open-auction": "open-auction",
  resume: "resume",
  "open-next": "open-next",
  sell: "close-lot",
  pass: "close-lot",
};

/** The handles the suites have always pressed these acts by. */
const PRIMARY_TEST_ID: Partial<Record<DeskAction["kind"], string>> = {
  "queue-lots": "cockpit-queue-lots",
  "open-auction": "cockpit-open-auction",
  resume: "cockpit-resume",
  "open-next": "cockpit-open-next",
  complete: "desk-complete",
  connecting: "desk-connecting",
};

const PRIMARY_ICON: Partial<Record<DeskAction["kind"], ReactNode>> = {
  "open-auction": <IconPlay size={22} weight="fill" />,
  "open-next": <IconPlay size={22} weight="fill" />,
  resume: <IconPlay size={22} weight="fill" />,
};

export function ConductorDesk({
  roles,
  snapshot,
  ceremony,
  remainingMs,
  clock,
  lotMedia,
  teams,
  rules,
  squadSizes,
  status,
  action,
  stale,
  pending,
  canOverride,
  undoable,
  gavelRef,
  controls,
}: {
  roles: readonly { key: string; label: string }[];
  snapshot: AuctionSnapshot | null;
  ceremony: CeremonyState;
  remainingMs: number | null;
  clock: AuctionClock;
  lotMedia: Readonly<Record<string, LotMedia>>;
  teams: readonly TeamIdentity[];
  rules: AuctionRules;
  squadSizes: Readonly<Record<string, number>>;
  status: string;
  action: DeskAction;
  stale: boolean;
  pending: string | null;
  canOverride: boolean;
  /** There is a result the engine can reverse (the snapshot's last outcome). */
  undoable: boolean;
  gavelRef: Ref<GavelHandle>;
  controls: DeskControls;
}) {
  const money = useMoney();
  const unit = useMoneyUnit();
  const labelOf = useMemo(() => roleLabeller(roles), [roles]);
  const lot = snapshot?.currentLot ?? null;
  const queue = snapshot?.queue ?? [];
  const outcome = snapshot?.lastOutcome ?? null;
  const live = status === "live";
  const paused = status === "paused";
  const between = lot === null;
  const next = queue[0] ?? null;
  // The name a hall calls a franchise by: its short name, else its first word
  // ("Pune" for Pune Panthers) — only ever on the phone's label, beside the
  // price row that names it in full.
  const shortOf = (teamName: string) =>
    teams.find((team) => team.name === teamName)?.shortName ?? teamName.split(" ")[0] ?? teamName;
  const words = deskActionWords(action, {
    amount: (value) => cardAmount(unit, value),
    teamLabel: shortOf,
  });
  const claimed = (snapshot?.paddles ?? []).filter((paddle) => !paddle.released);
  // The clock runs against the window the lot is actually on: an extended lot
  // restarts on the anti-snipe clock, not the opening one.
  const lotDurationMs =
    ((lot?.extensions ?? 0) > 0 ? rules.extensionSeconds : rules.initialSeconds) * 1000;

  return (
    <div className="desk" data-between={between ? "true" : "false"} data-status={status}>
      {/* ---- Column one: who is on the block (or who is next) ---------------- */}
      {snapshot === null ? (
        <div className="desk-stage">
          <CeremonyStage
            roles={roles}
            snapshot={snapshot}
            ceremony={ceremony}
            remainingMs={remainingMs}
            lotMedia={lotMedia}
          />
        </div>
      ) : (
        /* `ceremony` + `data-phase` are the long-standing handles on the room's
           moment (opening, bid, extension, sold, hold…): the cockpit's suites
           follow the night by them. */
        <section
          className="desk-stage"
          data-testid="ceremony"
          data-phase={ceremony.phase}
          aria-label={lot !== null ? "On the block" : "Next player"}
        >
          {lot !== null ? (
            <LotCard
              key={lot.lotId}
              name={lot.playerName ?? "Unnamed"}
              seed={lotSeed(lot.lotId, lotMedia)}
              photoUrl={lotMedia[lot.lotId]?.photoUrl ?? null}
              roleLabel={lot.role === "" ? null : labelOf(lot.role)}
              onBlock
              nameTestId="ceremony-player"
              kicker={<LotKicker lot={lot} media={lotMedia[lot.lotId]} />}
              clock={{
                remainingMs,
                totalMs: lotDurationMs,
                clock,
                frozen: paused,
                extensions: lot.extensions,
              }}
            />
          ) : next !== null ? (
            <LotCard
              key={next.lotId}
              className="desk-next-card"
              name={next.playerName ?? "Unnamed"}
              seed={lotSeed(next.lotId, lotMedia)}
              photoUrl={lotMedia[next.lotId]?.photoUrl ?? null}
              roleLabel={next.role === "" ? null : labelOf(next.role)}
              kicker={
                <>
                  Up next · {next.lotNumber} · base {money.ledger(next.basePrice)}
                </>
              }
            />
          ) : (
            <div className="desk-empty-card">
              <p className="desk-label">Nobody on the block</p>
              <p className="desk-empty-words">
                {status === "scheduled"
                  ? "Queue the players and the first one shows here."
                  : "The queue is empty."}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ---- Column two: the price and the gavel ---------------------------- */}
      <div className="desk-main">
        {lot !== null ? (
          <section className="desk-card desk-price" aria-label="The bidding">
            <LotPrice basePrice={lot.basePrice} bid={lot.currentBid} teams={teams} />
            <LotFacts lot={lot} />
          </section>
        ) : (
          <>
            {outcome !== null ? (
              <LastResult outcome={outcome} teams={teams} className="desk-card desk-result" />
            ) : null}
            {/* The phone's between-lots card (the mockup's "ready" state): the
                next player small, and the last result under him. The laptop
                shows the same two facts as the big card and the result above. */}
            <UpNextCompact
              next={next}
              outcome={outcome}
              lotMedia={lotMedia}
              teams={teams}
              labelOf={labelOf}
              status={status}
            />
          </>
        )}

        {live && claimed.length === 0 ? (
          <p className="cockpit-warn" data-testid="cockpit-no-paddles">
            No paddles are claimed. Opening a lot now puts a player on the block in an empty room.
          </p>
        ) : null}

        {/* THE THUMB BAR. On a phone it is pinned to the foot of the screen
            (safe-area aware) and the room scrolls beneath it; on a laptop it
            is the gavel desk in the middle column. One DOM, so there is one
            gavel and one set of handles whatever the width. */}
        <section className="desk-bar" aria-label="Conduct" data-testid="conduct-card">
          <PrimaryAction
            action={action}
            label={words.label}
            shortLabel={words.shortLabel}
            stale={stale}
            pending={pending}
            gavelRef={gavelRef}
            resetKey={gavelResetKey(lot)}
            controls={controls}
          />
          <div className="desk-row">
            {live ? (
              <button
                type="button"
                className="desk-chip"
                onClick={controls.pause}
                disabled={stale || pending === "pause"}
                aria-busy={pending === "pause" || undefined}
                data-testid="cockpit-pause"
              >
                <IconPause size={18} weight="fill" aria-hidden />
                Pause
                <kbd className="desk-kbd">P</kbd>
              </button>
            ) : null}
            {lot !== null ? (
              <button
                type="button"
                className="desk-chip"
                onClick={controls.freeze}
                disabled={stale || pending === "freeze"}
                aria-busy={pending === "freeze" || undefined}
                data-testid="cockpit-freeze"
              >
                <IconLock size={18} aria-hidden />
                Freeze lot
              </button>
            ) : null}
            <MoreMenu
              items={[
                ...(action.kind === "queue-lots"
                  ? []
                  : [
                      {
                        key: "queue",
                        group: "Setup",
                        label: "Queue lots",
                        detail: "Adds approved players who are not in the order yet",
                        testId: "cockpit-queue-lots",
                        onSelect: controls.queueLots,
                        disabled: stale,
                        busy: pending === "queue",
                      },
                    ]),
                ...(canOverride
                  ? [
                      {
                        key: "undo",
                        group: "Corrections — these change the record",
                        label: "Undo last result",
                        detail: "Asks first, and names what it reverses",
                        testId: "cockpit-undo",
                        onSelect: controls.undo,
                        disabled: !undoable || !live || stale,
                        grave: true,
                      },
                    ]
                  : []),
                {
                  key: "recover",
                  group: "Corrections — these change the record",
                  label: "Recover engine",
                  detail: "Rebuilds the room from the ledger and verifies it",
                  testId: "cockpit-recover",
                  onSelect: controls.recover,
                  disabled: stale,
                  busy: pending === "recover",
                  grave: true,
                },
                {
                  key: "complete",
                  group: "Close the night",
                  label: "Complete auction",
                  detail: "Asks first. Cannot be undone",
                  testId: "cockpit-complete",
                  onSelect: controls.complete,
                  disabled: stale,
                  grave: true,
                },
              ]}
            />
          </div>
          {/* The hold is explained here, and the gavel points at it
              (aria-describedby). Shortcuts are discoverable, not folklore. */}
          <p
            className="cockpit-keys desk-keys"
            id="cockpit-gavel-hint"
            data-testid="cockpit-shortcuts"
          >
            <span className="desk-why">{words.why}</span>
            {COCKPIT_SHORTCUTS.map((shortcut) => (
              <span key={shortcut.keys} className="desk-shortcut">
                <kbd>{shortcut.keys}</kbd> {shortcut.label}
              </span>
            ))}
          </p>
        </section>

        {/* The auctioneer was the only surface without a running record of the
            bidding — owner, spectate and replay all had one. */}
        <section className="desk-card desk-bids" data-testid="cockpit-bid-feed">
          <div className="desk-card-head">
            <h2>Bids on this lot</h2>
            {lot !== null ? <span className="desk-muted">{lot.lotNumber}</span> : null}
          </div>
          {lot === null || lot.bidHistory.length === 0 ? (
            <p className="desk-muted" data-testid="cockpit-bid-feed-empty">
              {lot === null
                ? "Open a lot and the bidding shows up here."
                : "Awaiting the first paddle…"}
            </p>
          ) : (
            <BidFeedList
              bids={lot.bidHistory}
              playerName={lot.playerName}
              teamColors={new Map(teams.map((team) => [team.name, team.primaryColor]))}
            />
          )}
        </section>
      </div>

      {/* ---- Column three: the room ------------------------------------------ */}
      <div className="desk-rail">
        <Paddles snapshot={snapshot} teams={teams} rules={rules} squadSizes={squadSizes} />
        <UpNextList
          queue={queue}
          lotMedia={lotMedia}
          labelOf={labelOf}
          opensWithO={live && lot === null}
        />
      </div>
    </div>
  );
}

/** "L001 · #R0HA7KR · base 1,000 pts" over the name (extensions are in the facts line). */
function LotKicker({ lot, media }: { lot: Lot; media: LotMedia | undefined }) {
  const money = useMoney();
  const number = media?.number ?? null;
  return (
    <>
      {lot.lotNumber}
      {number === null ? null : <span> · #{number}</span>} · base {money.ledger(lot.basePrice)}
    </>
  );
}

/** Next bid, bids, teams in, extensions — the facts a conductor calls. */
function LotFacts({ lot }: { lot: Lot }) {
  const money = useMoney();
  const teamsIn = new Set(lot.bidHistory.map((bid) => bid.teamName)).size;
  const bids = lot.bidHistory.length;
  return (
    <p className="desk-facts" data-testid="desk-facts">
      <span>
        Next bid <b>{money.ledger(lot.nextMinimumBid)}</b>
      </span>
      <span>
        {bids} bid{bids === 1 ? "" : "s"} · {teamsIn} team{teamsIn === 1 ? "" : "s"} in
      </span>
      <span>
        {lot.extensions} extension{lot.extensions === 1 ? "" : "s"}
      </span>
    </p>
  );
}

/** One sentence for what happened to the last lot, in the room's own words. */
function resultSentence(outcome: Outcome, ledger: (value: number) => string): ReactNode {
  const name = outcome.playerName ?? outcome.lotNumber;
  switch (outcome.kind) {
    case "sold":
      return (
        <>
          {name} sold{outcome.teamName === null ? "" : ` to ${outcome.teamName}`}
          {outcome.amount === null ? null : (
            <>
              {" "}
              for <b>{ledger(outcome.amount)}</b>
            </>
          )}
        </>
      );
    case "unsold":
      return <>{name} drew no bid — unsold</>;
    case "withdrawn":
      return <>{name} was withdrawn from the auction</>;
    case "held":
      return <>{name} is frozen, clock stopped — requeue or withdraw under Needs resolution</>;
    case "reopened":
      return <>{name}&apos;s result was undone</>;
  }
}

function LastResult({
  outcome,
  teams,
  className,
}: {
  outcome: Outcome;
  teams: readonly TeamIdentity[];
  className?: string;
}) {
  const money = useMoney();
  const team =
    outcome.teamName === null ? undefined : teams.find((entry) => entry.name === outcome.teamName);
  return (
    <section className={className} data-testid="desk-last-result" data-kind={outcome.kind}>
      <p className="desk-label">Last lot · {outcome.lotNumber}</p>
      <p className="desk-result-line">
        <span className="desk-verdict" data-kind={outcome.kind}>
          {OUTCOME_TITLE[outcome.kind]}
        </span>
        {outcome.kind === "sold" && outcome.paddleNumber !== null ? (
          <PurseTeamCrest team={team} fallback={outcome.paddleNumber} />
        ) : null}
        <span>{resultSentence(outcome, money.ledger)}</span>
      </p>
    </section>
  );
}

/** The phone's "ready" card: who opens next, and how the last lot went. */
function UpNextCompact({
  next,
  outcome,
  lotMedia,
  teams,
  labelOf,
  status,
}: {
  next: QueueEntry | null;
  outcome: Outcome | null;
  lotMedia: Readonly<Record<string, LotMedia>>;
  teams: readonly TeamIdentity[];
  labelOf: (role: string | null) => string;
  status: string;
}) {
  const money = useMoney();
  return (
    <section className="desk-card desk-next" aria-label="Ready for the next lot">
      {next !== null ? (
        <>
          <p className="desk-label">Up next · {next.lotNumber}</p>
          <div className="desk-next-who">
            <span className="desk-thumb desk-thumb--lg">
              <PlayerPortrait
                name={next.playerName ?? "Unnamed"}
                seed={lotSeed(next.lotId, lotMedia)}
                src={lotMedia[next.lotId]?.photoUrl ?? null}
                decorative
              />
            </span>
            <span className="desk-next-words">
              <span className="desk-next-name">{next.playerName ?? "Unnamed"}</span>
              <span className="desk-muted">
                {next.role === "" ? "" : `${labelOf(next.role)} · `}base{" "}
                {money.ledger(next.basePrice)}
              </span>
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="desk-label">Up next</p>
          <p className="desk-empty-words">
            {status === "scheduled"
              ? "Nobody is queued yet — queue the players first."
              : "The queue is empty."}
          </p>
        </>
      )}
      {outcome !== null ? (
        <div className="desk-next-last">
          <LastResult outcome={outcome} teams={teams} className="desk-last-inline" />
        </div>
      ) : null}
    </section>
  );
}

/** Who is in the room: every franchise, its paddle, what it can still spend. */
function Paddles({
  snapshot,
  teams,
  rules,
  squadSizes,
}: {
  snapshot: AuctionSnapshot | null;
  teams: readonly TeamIdentity[];
  rules: AuctionRules;
  squadSizes: Readonly<Record<string, number>>;
}) {
  const unit = useMoneyUnit();
  const paddles = snapshot?.paddles ?? [];
  const leader = snapshot?.currentLot?.currentBid?.teamName ?? null;
  const rows = teams.map((team) => {
    const held = paddles.find((paddle) => paddle.teamId === team.id && !paddle.released);
    const purse =
      held?.purseRemaining ??
      paddles.find((paddle) => paddle.teamId === team.id)?.purseRemaining ??
      null;
    const squad = squadSizes[team.id] ?? 0;
    const upTo =
      purse === null
        ? null
        : Number(
            maxAffordableBid({
              purseRemaining: purse,
              squadSize: squad,
              squadMin: rules.squadMin,
              minPossiblePrice: rules.minPossiblePrice,
            }),
          );
    return { team, held, upTo, squad, leading: leader !== null && leader === team.name };
  });
  const inRoom = rows.filter((row) => row.held !== undefined).length;
  const headId = useId();
  return (
    <section className="desk-card desk-paddles" aria-labelledby={headId} data-testid="desk-paddles">
      <div className="desk-card-head">
        <h2 id={headId}>Paddles</h2>
        <span className="desk-room" data-full={inRoom === teams.length ? "true" : "false"}>
          {inRoom} of {teams.length} in the room
        </span>
      </div>
      <ul className="desk-paddle-list">
        {rows.map((row) => (
          <li key={row.team.id} data-leading={row.leading ? "true" : undefined}>
            <PurseTeamCrest team={row.team} fallback={row.held?.paddleNumber ?? "—"} />
            <span className="desk-paddle-words">
              <span className="desk-paddle-name">{row.team.name}</span>
              <span className="desk-muted">
                {row.held === undefined ? "No paddle claimed" : row.held.paddleNumber}
                {row.upTo === null ? "" : ` · up to ${cardAmount(unit, row.upTo)}`} · squad{" "}
                {row.squad}/{rules.squadMax}
              </span>
            </span>
            {row.leading ? <span className="desk-leading">Leading</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The next few players, small, with how to open the first. */
function UpNextList({
  queue,
  lotMedia,
  labelOf,
  opensWithO,
}: {
  queue: readonly QueueEntry[];
  lotMedia: Readonly<Record<string, LotMedia>>;
  labelOf: (role: string | null) => string;
  opensWithO: boolean;
}) {
  const money = useMoney();
  const headId = useId();
  const shown = queue.slice(0, 3);
  return (
    <section className="desk-card desk-upnext" aria-labelledby={headId}>
      <div className="desk-card-head">
        <h2 id={headId}>Up next</h2>
        {opensWithO && shown.length > 0 ? (
          <span className="desk-muted">
            <kbd className="desk-kbd">O</kbd> opens it
          </span>
        ) : (
          <span className="desk-muted">{queue.length} in the queue</span>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="desk-muted">Nobody is waiting.</p>
      ) : (
        <ol className="desk-upnext-list">
          {shown.map((entry) => (
            <li key={entry.lotId}>
              <span className="desk-thumb">
                <PlayerPortrait
                  name={entry.playerName ?? "Unnamed"}
                  seed={lotSeed(entry.lotId, lotMedia)}
                  src={lotMedia[entry.lotId]?.photoUrl ?? null}
                  decorative
                />
              </span>
              <span className="desk-paddle-words">
                <span className="desk-paddle-name">{entry.playerName ?? "Unnamed"}</span>
                <span className="desk-muted">
                  {entry.lotNumber}
                  {entry.role === "" ? "" : ` · ${labelOf(entry.role)}`} · base{" "}
                  {money.ledger(entry.basePrice)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * THE ONE BUTTON. A gavel act is the hold gate (GavelButton, unchanged
 * semantics); everything else is a click on the command it names. The box is
 * full-width and one line tall in every state, so a label that changes under
 * a held pointer (a new leader, mid-hold) can never resize it.
 */
function PrimaryAction({
  action,
  label,
  shortLabel,
  stale,
  pending,
  gavelRef,
  resetKey,
  controls,
}: {
  action: DeskAction;
  label: string;
  shortLabel: string;
  stale: boolean;
  pending: string | null;
  gavelRef: Ref<GavelHandle>;
  /** `gavelResetKey(lot)`: a new bid mid-hold aborts the hold. */
  resetKey: string;
  controls: DeskControls;
}) {
  if (action.kind === "finished") {
    return null;
  }
  // Both wordings are in the button; the width decides which one shows. The
  // hidden one is display:none, so the button's name is only ever the one seen.
  const words = (
    <>
      <span className="desk-long">{label}</span>
      <span className="desk-short">{shortLabel}</span>
    </>
  );
  if (isGavelAction(action)) {
    return (
      <GavelButton
        ref={gavelRef}
        className="desk-primary desk-primary--gavel"
        label={words}
        holdingLabel="Keep holding…"
        icon={<IconGavel size={24} weight="fill" />}
        disabled={stale || pending === "close-lot"}
        resetKey={resetKey}
        onConfirm={controls.gavel}
      />
    );
  }
  const key = PENDING_KEY[action.kind];
  const busy = key !== undefined && pending === key;
  return (
    <button
      type="button"
      className="desk-primary"
      data-kind={action.kind}
      data-testid={PRIMARY_TEST_ID[action.kind]}
      onClick={action.kind === "complete" ? controls.complete : controls.primary}
      disabled={stale || busy || action.kind === "connecting"}
      aria-busy={busy || undefined}
    >
      {PRIMARY_ICON[action.kind] === undefined ? null : (
        <span className="desk-primary-icon" aria-hidden>
          {PRIMARY_ICON[action.kind]}
        </span>
      )}
      <span className="desk-primary-label">{words}</span>
      {action.kind === "open-next" ? <kbd className="desk-kbd">O</kbd> : null}
      {action.kind === "resume" ? <kbd className="desk-kbd">P</kbd> : null}
    </button>
  );
}

interface MoreItem {
  key: string;
  group: string;
  label: string;
  detail: string;
  testId: string;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
  grave?: boolean;
}

/**
 * "More" — the controls a night needs rarely, and the ones that change the
 * record, one tap further away than the gavel. A disclosure, not an ARIA menu:
 * its items are ordinary buttons (with their own busy and disabled states), so
 * the page's keyboard guards treat a focused item exactly as they treat any
 * other button. Escape and a press outside close it.
 */
function MoreMenu({ items }: { items: readonly MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    rootRef.current?.querySelector<HTMLButtonElement>(".desk-more-item:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const groups = items.reduce<{ title: string; items: MoreItem[] }[]>((acc, item) => {
    const last = acc[acc.length - 1];
    if (last !== undefined && last.title === item.group) {
      last.items.push(item);
    } else {
      acc.push({ title: item.group, items: [item] });
    }
    return acc;
  }, []);

  return (
    <div className="desk-more" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="desk-chip"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
        data-testid="cockpit-more"
      >
        <IconKebab size={18} aria-hidden />
        More
      </button>
      {open ? (
        <div id={panelId} className="desk-more-panel" data-testid="cockpit-more-panel">
          {groups.map((group) => (
            <div
              key={group.title}
              className="desk-more-group"
              role="group"
              aria-label={group.title}
            >
              <p className="desk-more-title" aria-hidden>
                {group.title}
              </p>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="desk-more-item"
                  data-grave={item.grave === true ? "true" : undefined}
                  disabled={item.disabled === true || item.busy === true}
                  aria-busy={item.busy === true || undefined}
                  data-testid={item.testId}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <span className="desk-more-label">{item.label}</span>
                  <span className="desk-more-detail">{item.detail}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
