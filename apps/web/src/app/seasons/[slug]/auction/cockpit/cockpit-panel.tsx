"use client";

import { commandRefusalMessage } from "@desiauction/core";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Select,
  useToast,
  Dialog,
  Field,
  IconArrowRight,
  IconClock,
  IconEye,
  IconList,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { resolveKeyDown, resolveKeyUp } from "../../../../../components/auction/cockpit-keys";
import { deskActionOf } from "../../../../../components/auction/desk-action";
import {
  lotsNeedingResolution,
  unsoldToRequeue,
} from "../../../../../components/auction/needs-resolution";
import { HashTabs } from "../../../../../components/hash-tabs/hash-tabs";
import { formatDateTime } from "../../../../../lib/format-date";
import { personContact } from "../../../../../lib/person-label";
import { ConductorDesk, type DeskControls } from "./conductor-desk";
import { BaseDetail, LotQueueList } from "./lot-queue";
import type { GavelHandle } from "./gavel-button";
import type { CockpitView } from "../../../../../server/auction/conduct-actions";
// Straight from its own module: a "use server" file may export only async
// functions, and Turbopack compiled its `export type` re-export into a real
// export that does not exist — the cockpit 500'd on every load.
import type { OwnerAcceptance } from "../../../../../server/auction/owner-acceptances";
import {
  grantPaddleAction,
  inviteOwnerAction,
  revokeOwnerInviteAction,
} from "../../../../../server/auction/owner-actions";
import { submitAuctionCommand } from "../../../../../server/auction/live-actions";
import { PageStatus } from "../../../../../components/shell/page-status";
import { AuctionAnnouncer } from "../auction-announcer";
import { BroadcastLinks } from "../broadcast-links";
import { CeremonyStage } from "../ceremony-stage";
import { PurseBoard } from "../purse-board";
import { PoolSummary, SquadBoard, squadSizesOf } from "../squad-board";
import { useLiveFeed } from "../live-experience";
import { StatusRibbon } from "../status-ribbon";
import { useAuctionSocket } from "../use-auction-socket";
import { useCeremonySound } from "../use-ceremony-sound";
import { useHydrated } from "../../../../../lib/use-hydrated";
import { useMoney } from "../../../../../components/money-unit";
import { formatCount } from "../../../../../lib/plural";

// THE AUCTION COCKPIT (M-IP4-3). The organizer's control room: open, pause,
// resume, open ANY queued lot (order control = skip/bring-forward, doc 41),
// withdraw, freeze, requeue, gavel, compensating undo, recover — every button
// SUBMITS A COMMAND. This component decides nothing; the engine acks decide.

function commandId(): string {
  return crypto.randomUUID();
}

/**
 * "Priya Sharma · +91 93301 00281 · accepted 28 Jul 2026, 7:12 pm".
 *
 * An owner invitation is an unaddressed bearer token: the organizer cannot know
 * in advance who will use it, so the least the product can do is say who DID.
 * The panel previously showed a name or the literal word "Owner", and never a
 * phone number anywhere.
 */
function describeAcceptor(who: OwnerAcceptance): string {
  return [
    who.name ?? "Unnamed account",
    personContact(who),
    who.acceptedAt === null ? null : `accepted ${formatDateTime(who.acceptedAt)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

export function CockpitPanel({ slug, view }: { slug: string; view: CockpitView }) {
  const money = useMoney();
  const router = useRouter();
  const toast = useToast();
  // DA: the hook already computed `stale` and `offline`; the cockpit destructured
  // neither. The auctioneer could hold the gavel over a snapshot the engine had
  // stopped confirming, with a green badge on screen — /live has had a
  // role="alert" staleness banner all along and the CONDUCTING surface had none.
  const { snapshot, connection, remainingMs, ceremony, stale, offline, clock } = useAuctionSocket(
    view.wsUrl,
  );
  /*
   * THE CONDUCTOR'S OWN SCREEN WAS THE STALE ONE.
   *
   * `/live` and `/spectate` both fed their pool, purse and squad panels from
   * `useLiveFeed`, which folds each outcome off the socket into the
   * server-rendered list. The cockpit passed `view.resolved` straight through —
   * the value as it was when the page loaded — so every one of those panels
   * froze at the moment the conductor opened it.
   *
   * Observed on a four-lot auction: after two lots had sold the pool read
   * "Sold 1 · Unsold 1 · Remaining 1". Not merely out of date — three of four
   * lots, a total that cannot be right, on the one screen whose job is to tell
   * the person running the room where the night has got to. Spectators had the
   * correct numbers the whole time.
   */
  const feed = useLiveFeed(view.resolved, snapshot);
  // The conductor hears the room too: opt-in, off by default (doc 11 sound).
  useCeremonySound({ ceremony, remainingMs, lotId: snapshot?.currentLot?.lotId ?? null });
  /**
   * DA: one global `busy` flag disabled 21 buttons at once — including the
   * gavel — for the duration of ANY command. The key names the single control
   * that is actually in flight.
   */
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;
  const [inviteTeam, setInviteTeam] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const hydrated = useHydrated();

  /*
   * STABLE ACROSS RENDERS, BECAUSE A WINDOW LISTENER DEPENDS ON IT.
   *
   * The keyboard effect below lists `send` among its dependencies and its
   * comment says it re-subscribes "whenever the room state the guards read
   * changes". It did not: a function literal is a new value every render, so
   * both window listeners were torn down and re-registered on EVERY render —
   * and this panel re-renders once a second from the countdown alone, for the
   * length of an auction. The comment described the intent; this makes it true.
   *
   * The closure is exact: `slug` is a prop, `router` and `toast` are stable by
   * construction (`useRouter`, and a `useCallback` behind `ToastProvider`), and
   * `setPending` is a setState. Nothing here can go stale.
   */
  const send = useCallback(
    async (key: string, type: string, payload: Record<string, unknown>, done?: string) => {
      // The same repair as the live room's `send`: a REJECTED request (offline
      // handset, server restart, proxy) skipped `setPending(null)` entirely, so
      // the control it names — including the gavel — stayed disabled for the rest
      // of the session with nothing said. See live-panel.tsx for the full note.
      setPending(key);
      let ack;
      try {
        ack = await submitAuctionCommand(slug, commandId(), type, payload);
      } catch {
        // See live-panel.tsx: a rejected promise means the answer is missing, not
        // that the command failed, so the message says only that and sends the
        // conductor to server truth rather than asserting an outcome.
        toast({
          title:
            "Lost the connection before the auction answered — check the bid feed before acting again.",
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
        router.refresh();
        return true;
      }
      toast({ title: commandRefusalMessage(ack.reason), tone: "danger" });
      return false;
    },
    [slug, router, toast],
  );

  /**
   * ROUND TWO IN ONE PRESS. The same `RequeueLot` the per-row button sends,
   * once per unsold lot, one after another — so every lot goes through the
   * engine's own gauntlet (rounds used, unsold policy) exactly as a click
   * would. The queue is ordered by the lot's draw, so the order these land in
   * does not matter. The first refusal stops the sweep and is said once, with
   * how many made it back, rather than a toast per row.
   */
  const requeueAllUnsold = async (lotIds: readonly string[]) => {
    setPending("requeue-all");
    let requeued = 0;
    let refusal: string | null = null;
    try {
      for (const lotId of lotIds) {
        const ack = await submitAuctionCommand(slug, commandId(), "RequeueLot", { lotId });
        if (!ack.accepted) {
          refusal = commandRefusalMessage(ack.reason);
          break;
        }
        requeued += 1;
      }
    } catch {
      refusal =
        "Lost the connection before the auction answered — check the queue before acting again.";
    } finally {
      setPending(null);
    }
    if (refusal === null) {
      toast({
        title: `${String(requeued)} unsold ${requeued === 1 ? "player is" : "players are"} back in the queue`,
        tone: "success",
      });
    } else {
      toast({
        title: `${String(requeued)} of ${String(lotIds.length)} requeued — ${refusal}`,
        tone: "danger",
      });
    }
    router.refresh();
  };

  /**
   * DA-16: completing an auction is irreversible and was one unguarded click.
   * DA-06 makes short squads refuse; the conductor may still close the night,
   * but only deliberately and only with a reason that lands in the ledger.
   *
   * Deliberately the repo's Dialog, not window.confirm/prompt: native dialogs
   * are unstyleable, ignore the theme, and are auto-dismissed by automation —
   * which silently made the completion path untestable and broke the ceremony
   * e2e journey.
   */
  const [completeOpen, setCompleteOpen] = useState(false);
  const [shortSquads, setShortSquads] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const confirmComplete = async () => {
    const payload = shortSquads
      ? { overrideSquadMinimum: true, reason: overrideReason.trim() }
      : {};
    setPending("complete");
    let ack;
    try {
      ack = await submitAuctionCommand(slug, commandId(), "CompleteAuction", payload);
    } catch {
      toast({
        title:
          "Lost the connection before the auction answered — reload to see whether the night closed.",
        tone: "danger",
      });
      return;
    } finally {
      setPending(null);
    }
    if (ack.accepted) {
      setCompleteOpen(false);
      setShortSquads(false);
      setOverrideReason("");
      toast({ title: "Auction completed", tone: "success" });
      router.refresh();
      return;
    }
    if (ack.reason === "squad_below_minimum") {
      // Second act, same dialog: name the problem and ask for a reason.
      setShortSquads(true);
      return;
    }
    toast({ title: commandRefusalMessage(ack.reason), tone: "danger" });
  };

  /**
   * DA-P0-5/P0-6 — UNDO, the most dangerous button in the product.
   *
   * It reversed a sale, a squad place and a team's money in front of a hall on
   * ONE unguarded click, while Complete — far less dangerous, because Complete
   * only ends a night that was ending anyway — had a two-act dialog. The risk
   * was exactly inverted. So: name what is about to be reversed, in the words
   * the room used when it happened.
   *
   * And undo silently restarted a THIRTY-SECOND LIVE CLOCK. Reproduced:
   * "UNDONE — BACK ON THE BLOCK · 28s", already counting down; twenty-eight
   * seconds later the log recorded LotUnsold. A correction turned into a lost
   * player. The engine's reopen edge writes a fresh window and that is its
   * business (the app is wrong where it disagrees with the engine), so the
   * cockpit immediately FREEZES the reopened lot: the correction lands, the
   * clock does not run, and restarting it is a separate, deliberate act.
   */
  const [undoOpen, setUndoOpen] = useState(false);
  const undoTarget = snapshot?.lastOutcome ?? null;

  const confirmUndo = async () => {
    const target = undoTarget;
    if (target === null) {
      setUndoOpen(false);
      return;
    }
    const undone = await send(
      "undo",
      "UndoLastAction",
      {},
      "Undone — the lot is held, restart it when you're ready",
    );
    setUndoOpen(false);
    if (!undone) {
      return;
    }
    // Commands are serial per auction, so this lands on the reopened lot.
    await send("undo-hold", "HoldLot", { lotId: target.lotId }, undefined);
  };

  const invite = async () => {
    setPending("invite");
    const result = await inviteOwnerAction(slug, inviteTeam);
    setPending(null);
    if (result.ok) {
      setInviteCopied(false);
      setInviteUrl(`${window.location.origin}${result.joinPath}`);
      toast({ title: "Owner invitation minted — forward the link.", tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  };

  const revokeInvite = async (inviteId: string) => {
    setPending(`revoke-${inviteId}`);
    const result = await revokeOwnerInviteAction(slug, inviteId);
    setPending(null);
    if (result.ok) {
      toast({ title: "Link withdrawn — it no longer works.", tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error ?? "Refused.", tone: "danger" });
    }
  };

  /**
   * The owner URL had no copy control at all: a 32-character base64url token
   * had to be selected by hand off a wrapping mono line and pasted into
   * WhatsApp. Every other minted secret in the product (the org invite dialog)
   * has had a copy button for milestones.
   */
  const copyInvite = async () => {
    if (inviteUrl === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
    } catch {
      toast({ title: "Couldn't copy — select the link and copy it by hand.", tone: "danger" });
    }
  };

  /** Who accepted a given invitation — name, phone and when (see CockpitView). */
  const acceptanceOf = (inviteId: string) =>
    view.ownerAcceptances.find((row) => row.inviteId === inviteId);

  const grant = async (teamId: string, personId: string) => {
    setPending(`grant-${teamId}`);
    const result = await grantPaddleAction(slug, teamId, personId);
    setPending(null);
    if (result.ok) {
      toast({ title: "Paddle granted — the owner can claim now.", tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  };

  const status = snapshot?.auctionStatus ?? view.view.auction.status;
  const lot = snapshot?.currentLot ?? null;
  // Same reason as `send` above: `?? []` mints a new array whenever the
  // snapshot carries no queue, which re-ran the keyboard effect every render.
  const queue = useMemo(() => snapshot?.queue ?? [], [snapshot?.queue]);
  const live = status === "live";
  const finished = status === "completed" || status === "reconciled" || status === "abandoned";
  /*
   * Finished, and read from the server's record because the engine never
   * answered. The live room has said "This auction is over" in this state since
   * round 4; the cockpit still spent its first screen on a "Connecting…" stage
   * skeleton under a RECONNECTING chip, beside a card saying the night was over.
   */
  const overOffline = finished && snapshot === null;
  const finishedSold = feed.resolved.filter((row) => row.status === "sold");
  const finishedSpend = finishedSold.reduce((sum, row) => sum + (row.soldPrice ?? 0), 0);
  const finishedTop = finishedSold.reduce<(typeof finishedSold)[number] | null>(
    (best, row) => (best === null || (row.soldPrice ?? 0) > (best.soldPrice ?? 0) ? row : best),
    null,
  );
  const finishedUnsold = feed.resolved.filter((row) => row.status === "unsold").length;
  // Withdrawn lots never went under the hammer, so they are not in "of N".
  const finishedLots = finishedSold.length + finishedUnsold;
  const spentBy = new Map<string, number>();
  for (const row of finishedSold) {
    if (row.teamId !== null) {
      spentBy.set(row.teamId, (spentBy.get(row.teamId) ?? 0) + (row.soldPrice ?? 0));
    }
  }
  const teamName = (teamId: string | null): string | null =>
    view.teams.find((team) => team.id === teamId)?.name ?? null;
  // Reconciled with the socket so it moves on the same frame as the queue —
  // see needs-resolution.ts for the double listing this used to show.
  const needsResolution = useMemo(
    () => lotsNeedingResolution(view.view.lots, snapshot),
    [view.view.lots, snapshot],
  );

  /**
   * v1.1 G1 — page-level keyboard control. Every guard lives in the pure
   * `resolveKeyDown`/`resolveKeyUp` (unit-tested): typing in a field, a focused
   * control's native Space, modifier chords and in-flight commands are all
   * refused there, so this effect only routes an already-approved intent.
   * Space drives the SAME hold gate the gavel button owns — it can never close a
   * lot on its own.
   */
  const gavelRef = useRef<GavelHandle>(null);
  useEffect(() => {
    const context = {
      status,
      hasOpenLot: lot !== null,
      hasQueue: queue.length > 0,
      busy,
    };
    const describe = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return {
        targetTag: element?.tagName.toLowerCase() ?? "",
        isContentEditable: element?.isContentEditable === true,
      };
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveKeyDown(
        {
          key: event.key,
          repeat: event.repeat,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          ...describe(event.target),
        },
        context,
      );
      if (action === null) {
        return;
      }
      // Only now do we own the keystroke (Space would otherwise scroll).
      event.preventDefault();
      if (action === "hold-start") {
        gavelRef.current?.start();
      } else if (action === "open-next") {
        const next = queue[0];
        if (next !== undefined) {
          void send(
            "open-next",
            "OpenLot",
            { lotId: next.lotId },
            `${next.lotNumber} on the block`,
          );
        }
      } else if (action === "toggle-pause") {
        void (status === "paused"
          ? send("resume", "ResumeAuction", {}, "Resumed")
          : send("pause", "PauseAuction", {}, "Paused"));
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (resolveKeyUp({ key: event.key, ...describe(event.target) }) === "hold-stop") {
        gavelRef.current?.stop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // Re-subscribed whenever the room state the guards read changes. `send`
    // closes over only stable values (slug prop, router, toast, setPending), so it
    // cannot go stale between these re-subscriptions.
  }, [status, lot, queue, busy, send]);
  const grantable = view.owners.invites.filter(
    (entry) =>
      entry.acceptedBy !== null &&
      !view.owners.grants.some(
        (grantRow) => grantRow.teamId === entry.teamId && grantRow.personId === entry.acceptedBy,
      ),
  );

  /*
   * THE DESK'S ONE BUTTON (live-room stage 2): which act the room is waiting
   * for, named. Pure (desk-action.ts, unit-tested); the handlers below are the
   * same commands the old Conduct card's buttons sent, keyed the same way.
   */
  const action = deskActionOf({
    status,
    connected: snapshot !== null,
    lot,
    queue,
  });
  const squadSizes = squadSizesOf(view.teams, view.preSigned, feed.resolved);
  const deskControls: DeskControls = {
    primary: () => {
      switch (action.kind) {
        case "queue-lots":
          void send("queue", "QueueLots", {}, "Lots queued");
          return;
        case "open-auction":
          void send("open-auction", "OpenAuction", {}, "Auction opened");
          return;
        case "resume":
          void send("resume", "ResumeAuction", {}, "Resumed");
          return;
        case "open-next":
          void send(
            "open-next",
            "OpenLot",
            { lotId: action.lotId },
            `${action.lotNumber} on the block`,
          );
          return;
        default:
          return;
      }
    },
    gavel: () => {
      if (lot !== null) {
        void send("close-lot", "CloseLot", { lotId: lot.lotId }, "Gavel — lot closed");
      }
    },
    pause: () => void send("pause", "PauseAuction", {}, "Paused"),
    freeze: () => {
      if (lot !== null) {
        void send("freeze", "HoldLot", { lotId: lot.lotId }, "Lot frozen");
      }
    },
    undo: () => {
      setUndoOpen(true);
    },
    recover: () => void send("recover", "RecoverAuction", {}, "Recovered — state verified"),
    complete: () => {
      setCompleteOpen(true);
    },
    queueLots: () => void send("queue", "QueueLots", {}, "Lots queued"),
  };

  return (
    <div
      className="competitions-stack"
      data-testid="cockpit-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <AuctionAnnouncer snapshot={snapshot} ceremony={ceremony} remainingMs={remainingMs} />
      {/* One sticky bar, not two. The shell's header and this ribbon both stuck
          at top: 0 and overlapped; the ribbon belongs in the header, which is
          where /spectate has carried it since PX-6. */}
      <PageStatus>
        <StatusRibbon
          snapshot={snapshot}
          connection={connection}
          remainingMs={remainingMs}
          variant="shell"
          offline={offline}
          lotMedia={view.lotMedia}
          settledStatus={overOffline ? status : undefined}
          room
          viewer={{ label: "Conducting" }}
        />
      </PageStatus>

      {/* THE AUCTIONEER'S STALENESS BANNER. /live has had one since PX-6; the
          surface holding the gavel had none, so the gavel could be swung over a
          snapshot the engine had stopped confirming, under a green badge. */}
      {stale && snapshot !== null ? (
        <p role="alert" className="live-readonly" data-testid="cockpit-stale">
          {offline
            ? "This device is offline. The room below is the last state we heard — conduct is disabled until we're back."
            : "Reconnecting — the room below is the last state we heard. Conduct is disabled until the engine confirms it again."}
        </p>
      ) : null}

      {finished ? (
        /* Once the night is over the desk is the door to the record, not a
           panel of controls: "Conduct" over nothing to conduct. */
        <div className="cockpit-over">
          {overOffline ? null : (
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
          {/* THE NIGHT, CLOSED IN ONE CARD (2026-09-28). The finished cockpit
              was a second auction page — a record card, the unsold list, pool
              tiles that repeated the line above them and a squads grid — and
              never said where to go next. The next jobs (posters, squad
              sheets, captains) are on the auction page, so that is the door. */}
          <section
            className="night-over"
            data-testid="conduct-card"
            aria-labelledby="night-over-title"
          >
            <p className="night-over-kicker">
              {status === "abandoned" ? "The auction was abandoned" : "The night is over"}
            </p>
            <h2 id="night-over-title" className="night-over-count">
              {formatCount(finishedSold.length)} of {formatCount(finishedLots)} sold
            </h2>
            {finishedLots > 0 ? (
              <span className="night-over-bar" aria-hidden>
                <span
                  style={{
                    width: `${String(Math.round((finishedSold.length / finishedLots) * 100))}%`,
                  }}
                />
              </span>
            ) : null}
            <p className="night-over-line" data-testid="cockpit-record-line">
              {formatCount(finishedUnsold)} unsold · <strong>{money.ledger(finishedSpend)}</strong>{" "}
              spent
              {finishedTop !== null ? (
                <>
                  {" "}
                  · top buy <strong>{finishedTop.playerName ?? finishedTop.lotNumber}</strong>{" "}
                  {money.ledger(finishedTop.soldPrice ?? 0)}
                  {teamName(finishedTop.teamId) !== null
                    ? ` to ${teamName(finishedTop.teamId) ?? ""}`
                    : ""}
                </>
              ) : null}
            </p>
            {view.teams.length > 0 ? (
              <ul className="night-over-teams" aria-label="Squads">
                {view.teams.map((team) => (
                  <li key={team.id}>
                    <span
                      className="night-over-crest"
                      style={
                        team.primaryColor === null
                          ? undefined
                          : ({ "--team-color": team.primaryColor } as CSSProperties)
                      }
                      aria-hidden
                    >
                      {team.shortName ??
                        team.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((word) => word.charAt(0))
                          .join("")
                          .toUpperCase()}
                    </span>
                    <span className="night-over-team">
                      <strong>{team.name}</strong>
                      <span>
                        {formatCount(squadSizes[team.id] ?? 0)} of{" "}
                        {formatCount(view.rules.squadMax)} ·{" "}
                        {money.ledger(spentBy.get(team.id) ?? 0)} spent
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="night-over-note" data-testid="cockpit-finished">
              Nothing here can be opened, undone or recovered — the ledger and the replay are the
              record now.
            </p>
            <div className="night-over-doors">
              <ButtonLink href={`/seasons/${slug}/auction`} variant="primary">
                Go to the auction page
                <IconArrowRight size={16} aria-hidden />
              </ButtonLink>
              <ButtonLink href={`/seasons/${slug}/auction/ledger`} variant="secondary">
                <IconList size={16} aria-hidden />
                Open the ledger
              </ButtonLink>
              <ButtonLink href={`/seasons/${slug}/auction/replay`} variant="ghost">
                <IconClock size={16} aria-hidden />
                Watch the replay
              </ButtonLink>
              <ButtonLink
                href={`/seasons/${slug}/auction/spectate`}
                variant="ghost"
                className="night-over-recap"
              >
                <IconEye size={16} aria-hidden />
                Public recap
              </ButtonLink>
            </div>
            <p className="night-over-note">
              What&apos;s next — result posters, squad sheets, telling the captains — is on the
              auction page.
            </p>
          </section>
        </div>
      ) : (
        <ConductorDesk
          roles={view.roles}
          snapshot={snapshot}
          ceremony={ceremony}
          remainingMs={remainingMs}
          clock={clock}
          lotMedia={view.lotMedia}
          teams={view.teams}
          rules={view.rules}
          squadSizes={squadSizes}
          status={status}
          action={action}
          stale={stale}
          pending={pending}
          canOverride={view.viewer.canOverride}
          undoable={undoTarget !== null}
          gavelRef={gavelRef}
          controls={deskControls}
        />
      )}

      {/* After the night the lower grid and the squads were the auction
          page again; the closing card above carries the doors to all of it. */}
      {finished ? null : (
        <div className="cockpit-grid cockpit-lower">
          <div className="cockpit-col">
            <section data-testid="queue-card" className="room-card" aria-label="Lot queue">
              <div className="room-card-head">
                <h2>Lot queue</h2>
                <span className="room-muted">
                  {queue.length === 0 ? "empty" : `${String(queue.length)} to go`}
                </span>
              </div>

              {queue.length === 0 ? (
                <p className="room-muted" data-testid="queue-empty">
                  No queued lots.
                </p>
              ) : (
                <LotQueueList
                  label="Queued lots"
                  roles={view.roles}
                  lotMedia={view.lotMedia}
                  rows={queue.map((entry) => ({
                    id: entry.lotId,
                    lotNumber: entry.lotNumber,
                    playerName: entry.playerName,
                    role: entry.role,
                    detail: <BaseDetail basePrice={entry.basePrice} />,
                    testId: `queue-${entry.lotNumber}`,
                    actions: (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void send(
                              `open-${entry.lotId}`,
                              "OpenLot",
                              { lotId: entry.lotId },
                              `${entry.lotNumber} on the block`,
                            )
                          }
                          loading={pending === `open-${entry.lotId}`}
                          disabled={lot !== null || !live || stale}
                          data-testid={`open-${entry.lotNumber}`}
                          aria-label={`Open ${entry.lotNumber}, ${entry.playerName ?? "unnamed"}`}
                        >
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void send(
                              `withdraw-${entry.lotId}`,
                              "WithdrawLot",
                              { lotId: entry.lotId },
                              `${entry.lotNumber} withdrawn`,
                            )
                          }
                          loading={pending === `withdraw-${entry.lotId}`}
                          disabled={stale}
                          data-testid={`withdraw-${entry.lotNumber}`}
                          aria-label={`Withdraw ${entry.lotNumber}, ${entry.playerName ?? "unnamed"}`}
                        >
                          Withdraw
                        </Button>
                      </>
                    ),
                  }))}
                />
              )}
              {needsResolution.length > 0 ? (
                <>
                  <>
                    <h2>Needs resolution</h2>
                    <p className="competitions-hint" data-testid="frozen-lot-hint">
                      A frozen lot has a clock that is stopped, not running — including one you have
                      just undone. Requeue it and it goes back to the top of the queue for you to
                      open deliberately.
                    </p>
                    {/* The second way out, and until now there was no first one for
                        half these lots. Requeue is refused when the auction's unsold
                        policy is "final", or when the lot has used its rounds — and
                        Requeue was the only button here. A frozen lot with a
                        mistaken bid on it could then be neither passed (it has
                        money on it) nor requeued, and a frozen lot blocks completing
                        the auction, so the night could not end without making the
                        sale the conductor froze the lot to avoid. */}
                    <p className="competitions-hint" data-testid="frozen-lot-withdraw-hint">
                      If Requeue is refused — this auction is set to one round, or the lot has used
                      them — <strong>Withdraw</strong> takes the player out of the auction for good
                      and voids any bid standing on the lot. It cannot be undone, and it is the only
                      way to close an auction that has a frozen lot on it.
                    </p>
                  </>

                  {unsoldToRequeue(needsResolution).length > 1 ? (
                    <div className="cockpit-actions">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void requeueAllUnsold(
                            unsoldToRequeue(needsResolution).map((entry) => entry.id),
                          )
                        }
                        loading={pending === "requeue-all"}
                        disabled={stale || (busy && pending !== "requeue-all")}
                        data-testid="requeue-all-unsold"
                      >
                        Requeue all unsold ({unsoldToRequeue(needsResolution).length})
                      </Button>
                    </div>
                  ) : null}
                  <LotQueueList
                    label="Lots that need resolving"
                    tone="attention"
                    roles={view.roles}
                    lotMedia={view.lotMedia}
                    rows={needsResolution.map((entry) => ({
                      id: entry.id,
                      lotNumber: entry.lotNumber,
                      playerName: entry.playerName,
                      // The row reads "Batter · unsold": the role says who the
                      // player is; the lot number stays on the row's own code.
                      role: entry.role,
                      detail: entry.status,
                      testId: `resolve-${entry.lotNumber}`,
                      actions: (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              void send(
                                `requeue-${entry.id}`,
                                "RequeueLot",
                                { lotId: entry.id },
                                `${entry.lotNumber} requeued`,
                              )
                            }
                            loading={pending === `requeue-${entry.id}`}
                            disabled={stale}
                            data-testid={`requeue-${entry.lotNumber}`}
                          >
                            Requeue
                          </Button>
                          {entry.status === "frozen" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void send(
                                  `withdraw-${entry.id}`,
                                  "WithdrawLot",
                                  { lotId: entry.id },
                                  `${entry.lotNumber} withdrawn`,
                                )
                              }
                              loading={pending === `withdraw-${entry.id}`}
                              disabled={stale}
                              data-testid={`withdraw-frozen-${entry.lotNumber}`}
                            >
                              Withdraw
                            </Button>
                          ) : null}
                        </>
                      ),
                    }))}
                  />
                </>
              ) : null}
            </section>
          </div>

          <div className="cockpit-col">
            {/* No progress bar here: the room's header says "n of N done" and
              the queue card says how many are to go (stage 3). */}
            {/* One panel at a time on the right: purses while the room is live,
              owners while it is being set up, and the two broadcast screens
              (DA-20 — their only door) a tab away instead of above both. */}
            <HashTabs
              label="Room panels"
              defaultId={status === "scheduled" ? "owners" : "purses"}
              tabs={[
                {
                  id: "purses",
                  label: "Purses",
                  content: (
                    <div className="cockpit-tab">
                      {/* The auctioneer's board carries every purse — and the
                        split the engine will enforce on the next bid, the
                        question they are asked between lots. */}
                      {/* Without the engine a purse is a column of dashes; the
                        squads below already say what each team spent. */}
                      {overOffline ? null : (
                        /* No "can bid up to" line: the desk's paddle rail says it
                         beside every team already. The board keeps what the
                         desk does not — the purse left and what is spent. */
                        <PurseBoard snapshot={snapshot} teams={view.teams} />
                      )}
                      <PoolSummary
                        snapshot={snapshot}
                        resolved={feed.resolved}
                        preSigned={view.preSigned}
                      />
                    </div>
                  ),
                },
                {
                  id: "owners",
                  label: "Owners",
                  content: (
                    <div className="cockpit-tab">
                      <Card data-testid="owners-card">
                        <h2>Owners &amp; paddles</h2>
                        <p className="competitions-hint">
                          Invitation → acceptance → grant → claim. No active paddle without an
                          explicit grant.
                        </p>
                        {/* P0-2 CLOSED. This card used to carry an apology — "an owner link
                cannot be withdrawn once you send it" — because `revoked_at` was
                read in six places and written in none. The command, the event
                and the control now exist, so the honest sentence is the one
                about what revoking can and cannot reach. */}
                        <p className="competitions-hint" data-testid="owner-invite-revocable">
                          A pending link can be withdrawn below, and stops working the moment you
                          do. Once somebody has <strong>accepted</strong> it they are in the club
                          and hold a paddle grant — withdrawing the link no longer reaches them, and
                          you remove the grant instead.
                        </p>
                        {/* Accepting a link makes the person a club member, so minting and
                withdrawing links is the club owners' act. An appointed
                auctioneer sees the board and grants paddles to people who
                have already accepted. */}
                        {view.viewer.canManage ? (
                          <div className="date-row">
                            <Select
                              label="Team"
                              name="inviteTeam"
                              value={inviteTeam}
                              onChange={(event) => {
                                setInviteTeam(event.target.value);
                              }}
                            >
                              <option value="">Choose…</option>
                              {view.teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                  {team.name}
                                </option>
                              ))}
                            </Select>
                            <Button
                              onClick={() => void invite()}
                              loading={pending === "invite"}
                              /* `finished` joins the derived blocked states. The control was
                   offered on a completed auction and failed on click with
                   "This auction has ended." — the panel already derived
                   !auctionExists and !canConduct, and simply never asked the
                   auction what state it was in. */
                              disabled={inviteTeam === "" || finished}
                              data-testid="invite-owner"
                            >
                              Invite owner
                            </Button>
                          </div>
                        ) : null}
                        {inviteUrl !== null ? (
                          <div className="owner-invite-result" data-testid="owner-invite-result">
                            {/* `owner-url` sets `font-variant-ligatures: none`: base64url
                    tokens contain `-`, and the mono face was ligating `--` into
                    one long dash. Roughly one token in 125 displayed wrongly,
                    and this string is copied by hand. */}
                            <span className="owner-url" data-testid="owner-invite-url">
                              {inviteUrl}
                            </span>
                            <div className="owner-invite-actions">
                              <Button
                                size="touch"
                                variant="secondary"
                                onClick={() => void copyInvite()}
                                data-testid="copy-owner-invite"
                              >
                                {inviteCopied ? "Copied" : "Copy link"}
                              </Button>
                              <span className="competitions-hint">
                                Send it yourself — the platform sends nothing. It works once and
                                cannot be withdrawn.
                              </span>
                            </div>
                          </div>
                        ) : null}

                        {view.owners.invites.length > 0 ? (
                          <div data-testid="owner-invites">
                            {view.owners.invites.map((entry) => {
                              const who = acceptanceOf(entry.id);
                              return (
                                <div
                                  key={entry.id}
                                  className="owner-row"
                                  data-testid={`invite-row-${entry.id}`}
                                >
                                  <Badge
                                    tone={
                                      entry.acceptedBy !== null
                                        ? "success"
                                        : entry.expired
                                          ? "danger"
                                          : "info"
                                    }
                                  >
                                    {entry.acceptedBy !== null
                                      ? "accepted"
                                      : entry.expired
                                        ? "expired"
                                        : "pending"}
                                  </Badge>
                                  <span className="registration-name">{entry.teamName}</span>
                                  {who === undefined ? null : (
                                    <span className="competitions-hint">
                                      {describeAcceptor(who)}
                                    </span>
                                  )}
                                  {/* Only while it is still a link. An accepted invitation
                          has already minted a membership and a paddle grant;
                          offering Withdraw there would promise to undo two
                          things it cannot touch. */}
                                  {view.viewer.canManage &&
                                  entry.acceptedBy === null &&
                                  !entry.expired ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => void revokeInvite(entry.id)}
                                      loading={pending === `revoke-${entry.id}`}
                                      data-testid={`revoke-invite-${entry.id}`}
                                    >
                                      Withdraw link
                                    </Button>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}

                        {grantable.length > 0 ? (
                          <>
                            <h2>Ready to grant</h2>
                            {/* THE MOMENT MONEY AUTHORITY CHANGES HANDS. This list used to
                    read "Owner" — the literal fallback string — for any account
                    without a name, with no phone anywhere, so two rows for the
                    same team (a legitimate owner and a stranger who opened a
                    forwarded link) were indistinguishable. */}
                            {grantable.map((entry) => {
                              const who = acceptanceOf(entry.id);
                              return (
                                <div
                                  key={entry.id}
                                  className="owner-row"
                                  data-testid={`grantable-${entry.id}`}
                                >
                                  <span className="registration-name">
                                    {who?.name ?? "Unnamed account"}
                                    {who === undefined ? null : (
                                      <span
                                        className="registration-phone"
                                        data-testid={`grantable-phone-${entry.id}`}
                                      >
                                        {personContact(who)}
                                      </span>
                                    )}
                                  </span>
                                  <span className="competitions-hint">
                                    {entry.teamName}
                                    {who?.acceptedAt == null
                                      ? ""
                                      : ` · accepted ${formatDateTime(who.acceptedAt)}`}
                                    {who !== undefined && !who.stillMember
                                      ? " · REMOVED from this organization"
                                      : ""}
                                  </span>
                                  <Button
                                    size="sm"
                                    onClick={() => void grant(entry.teamId, entry.acceptedBy ?? "")}
                                    loading={pending === `grant-${entry.teamId}`}
                                    /* Offboarded. `removeMember` cannot withdraw an auction
                           acceptance (no command exists), so the row survives —
                           but handing a paddle and a purse to somebody who has
                           been removed from the club is not a click to leave
                           enabled. */
                                    disabled={who !== undefined && !who.stillMember}
                                    data-testid={`grant-${entry.teamId}`}
                                  >
                                    Grant paddle
                                  </Button>
                                </div>
                              );
                            })}
                          </>
                        ) : null}

                        {view.owners.grants.length > 0 ? (
                          <div data-testid="grant-list">
                            {view.owners.grants.map((entry) => (
                              <div key={entry.id} className="owner-row">
                                <Badge tone={entry.claimed ? "success" : "neutral"}>
                                  {entry.claimed ? "claimed" : "granted"}
                                </Badge>
                                <span className="registration-name">
                                  {entry.personName ?? "Owner"}
                                </span>
                                <span className="competitions-hint">{entry.teamName}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </Card>
                    </div>
                  ),
                },
                {
                  id: "screens",
                  label: "Screens",
                  content: (
                    <div className="cockpit-tab">
                      <BroadcastLinks slug={slug} />
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}

      {finished ? null : (
        <SquadBoard
          roles={view.roles}
          teams={view.teams}
          lotMedia={view.lotMedia}
          preSigned={view.preSigned}
          resolved={feed.resolved}
          snapshot={snapshot}
          squadMax={view.rules.squadMax}
          collapsible
        />
      )}

      {/* UNDO's confirmation — it names what is about to be reversed. */}
      <Dialog
        open={undoOpen}
        onClose={() => {
          setUndoOpen(false);
        }}
        title="Undo the last result?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setUndoOpen(false);
              }}
            >
              Keep it
            </Button>
            <Button
              onClick={() => void confirmUndo()}
              loading={pending === "undo" || pending === "undo-hold"}
              data-testid="confirm-undo"
            >
              Undo — reverse this result
            </Button>
          </>
        }
      >
        {undoTarget === null ? (
          <p data-testid="undo-nothing">There is no result to undo.</p>
        ) : (
          <>
            <p data-testid="undo-summary">
              {undoTarget.kind === "sold" ? (
                <>
                  This reverses the sale of{" "}
                  <strong>{undoTarget.playerName ?? undoTarget.lotNumber}</strong>
                  {undoTarget.amount !== null ? (
                    <>
                      {" "}
                      for <strong>{money.ledger(undoTarget.amount)}</strong>
                    </>
                  ) : null}
                  {undoTarget.teamName !== null ? (
                    <>
                      {" "}
                      to <strong>{undoTarget.teamName}</strong>
                    </>
                  ) : null}
                  . The money goes back to their purse and the player leaves their squad.
                </>
              ) : (
                <>
                  This reverses the <strong>{undoTarget.kind}</strong> result on{" "}
                  <strong>{undoTarget.playerName ?? undoTarget.lotNumber}</strong>.
                </>
              )}
            </p>
            <p className="competitions-hint" data-testid="undo-held-note">
              Nothing is deleted — the reversal is appended to the ledger and stays visible. The lot
              comes back <strong>frozen, with the clock stopped</strong>. Requeue it from “Needs
              resolution” when you are ready to run it again.
            </p>
          </>
        )}
      </Dialog>

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
              loading={pending === "complete"}
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
