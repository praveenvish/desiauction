"use client";

import { formatPaiseINR, paise, commandRefusalMessage } from "@desiauction/core";
import { Badge, Button, Card, Select, useToast, Dialog, Field } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  COCKPIT_SHORTCUTS,
  resolveKeyDown,
  resolveKeyUp,
} from "../../../../../components/auction/cockpit-keys";
import { formatDateTime } from "../../../../../lib/format-date";
import { formatPhone } from "../../../../../lib/format-phone";
import { GavelButton, type GavelHandle } from "./gavel-button";
import type { CockpitView, OwnerAcceptance } from "../../../../../server/auction/conduct-actions";
import { grantPaddleAction, inviteOwnerAction } from "../../../../../server/auction/owner-actions";
import { submitAuctionCommand } from "../../../../../server/auction/live-actions";
import { PageStatus } from "../../../../../components/shell/page-status";
import { AuctionAnnouncer } from "../auction-announcer";
import { BroadcastLinks } from "../broadcast-links";
import { CeremonyStage } from "../ceremony-stage";
import { PurseBoard } from "../purse-board";
import { PoolSummary, SquadBoard } from "../squad-board";
import { AuctionProgress } from "../live-experience";
import { StatusRibbon } from "../status-ribbon";
import { useAuctionSocket } from "../use-auction-socket";

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
    formatPhone(who.phone),
    who.acceptedAt === null ? null : `accepted ${formatDateTime(who.acceptedAt)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

export function CockpitPanel({ slug, view }: { slug: string; view: CockpitView }) {
  const router = useRouter();
  const toast = useToast();
  // DA: the hook already computed `stale` and `offline`; the cockpit destructured
  // neither. The auctioneer could hold the gavel over a snapshot the engine had
  // stopped confirming, with a green badge on screen — /live has had a
  // role="alert" staleness banner all along and the CONDUCTING surface had none.
  const { snapshot, connection, remainingMs, ceremony, stale, offline } = useAuctionSocket(
    view.wsUrl,
  );
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
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const send = async (
    key: string,
    type: string,
    payload: Record<string, unknown>,
    done?: string,
  ) => {
    setPending(key);
    const ack = await submitAuctionCommand(slug, commandId(), type, payload);
    setPending(null);
    if (ack.accepted) {
      if (done !== undefined) {
        toast({ title: done, tone: "success" });
      }
      router.refresh();
      return true;
    }
    toast({ title: commandRefusalMessage(ack.reason), tone: "danger" });
    return false;
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
    const ack = await submitAuctionCommand(slug, commandId(), "CompleteAuction", payload);
    setPending(null);
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
  const queue = snapshot?.queue ?? [];
  const live = status === "live";
  const finished = status === "completed" || status === "reconciled" || status === "abandoned";
  /**
   * Nothing told the auctioneer that NOBODY was holding a paddle. Opening the
   * first lot into an empty room is a mistake you only discover from silence.
   */
  const claimedPaddles = (snapshot?.paddles ?? []).filter((paddle) => !paddle.released);
  const nextLot = queue[0] ?? null;

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

      <div className="cockpit-grid">
        <div className="cockpit-col">
          {/* THE DOCK. The cockpit runs to 1831px — two full screens at 1440×900
              — and at the moment the gavel was pressed the ceremony was entirely
              off-screen: the auctioneer could not see the lot and reach the
              gavel at the same time. The lot and the controls that act on it now
              travel together down the page. */}
          <div className="cockpit-dock">
            <CeremonyStage snapshot={snapshot} ceremony={ceremony} remainingMs={remainingMs} />

            {/* THE CONDUCT CARD, in three tiers.
              It used to be one flat row at equal weight — Pause · Queue lots ·
              Undo · Recover engine · Complete — every one of them enabled on a
              `scheduled` auction the engine would refuse, with the routine and
              the irreversible pressed against each other. And the primary act of
              the night, opening the next lot, HAD NO BUTTON HERE AT ALL: the
              auctioneer had to find it in the queue list below, while /live's
              weaker panel had "Open next lot (L001)" all along. */}
            <Card data-testid="conduct-card">
              <h2>Conduct</h2>

              {live && claimedPaddles.length === 0 ? (
                <p className="cockpit-warn" data-testid="cockpit-no-paddles">
                  No paddles are claimed. Opening a lot now puts a player on the block in an empty
                  room.
                </p>
              ) : null}

              <div className="cockpit-actions cockpit-actions--primary">
                {status === "scheduled" ? (
                  <Button
                    onClick={() => void send("open-auction", "OpenAuction", {}, "Auction opened")}
                    loading={pending === "open-auction"}
                    disabled={stale}
                    data-testid="cockpit-open-auction"
                  >
                    Open auction
                  </Button>
                ) : null}
                {lot === null && !finished ? (
                  <Button
                    onClick={() => {
                      if (nextLot !== null) {
                        void send(
                          "open-next",
                          "OpenLot",
                          { lotId: nextLot.lotId },
                          `${nextLot.lotNumber} on the block`,
                        );
                      }
                    }}
                    loading={pending === "open-next"}
                    disabled={nextLot === null || !live || stale}
                    data-testid="cockpit-open-next"
                  >
                    Open next lot{nextLot !== null ? ` (${nextLot.lotNumber})` : ""}
                  </Button>
                ) : null}
                {lot !== null ? (
                  <>
                    {/* v1.1 G2: closing a lot is a HOLD, not a click. It is no
                      longer taken away because some other command is in flight —
                      only because the snapshot under it cannot be trusted. */}
                    <GavelButton
                      ref={gavelRef}
                      disabled={stale || pending === "close-lot"}
                      onConfirm={() => {
                        void send(
                          "close-lot",
                          "CloseLot",
                          { lotId: lot.lotId },
                          "Gavel — lot closed",
                        );
                      }}
                    />
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void send("freeze", "HoldLot", { lotId: lot.lotId }, "Lot frozen")
                      }
                      loading={pending === "freeze"}
                      disabled={stale}
                      data-testid="cockpit-freeze"
                    >
                      Freeze lot
                    </Button>
                  </>
                ) : null}
                {live ? (
                  <Button
                    variant="secondary"
                    onClick={() => void send("pause", "PauseAuction", {}, "Paused")}
                    loading={pending === "pause"}
                    disabled={stale}
                    data-testid="cockpit-pause"
                  >
                    Pause
                  </Button>
                ) : null}
                {status === "paused" ? (
                  <Button
                    onClick={() => void send("resume", "ResumeAuction", {}, "Resumed")}
                    loading={pending === "resume"}
                    disabled={stale}
                    data-testid="cockpit-resume"
                  >
                    Resume
                  </Button>
                ) : null}
              </div>

              {/* v1.1 G1: shortcuts are discoverable, not folklore. */}
              <p className="cockpit-keys" id="cockpit-gavel-hint" data-testid="cockpit-shortcuts">
                {COCKPIT_SHORTCUTS.map((shortcut) => (
                  <span key={shortcut.keys}>
                    <kbd>{shortcut.keys}</kbd> {shortcut.label}
                  </span>
                ))}
              </p>

              {finished ? (
                <p className="competitions-hint" data-testid="cockpit-finished">
                  This auction is {status}. Nothing here can be opened, undone or recovered — the
                  ledger and the replay are the record now.
                </p>
              ) : (
                <div className="cockpit-secondary">
                  <h3 className="cockpit-group-title">Setup</h3>
                  <div className="cockpit-actions">
                    <Button
                      variant="secondary"
                      onClick={() => void send("queue", "QueueLots", {}, "Lots queued")}
                      loading={pending === "queue"}
                      disabled={stale}
                      data-testid="cockpit-queue-lots"
                    >
                      Queue lots
                    </Button>
                  </div>

                  <h3 className="cockpit-group-title cockpit-group-title--grave">
                    Corrections — these change the record
                  </h3>
                  <div className="cockpit-actions">
                    {view.viewer.canOverride ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setUndoOpen(true);
                        }}
                        disabled={undoTarget === null || !live || stale}
                        data-testid="cockpit-undo"
                      >
                        Undo last action
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void send("recover", "RecoverAuction", {}, "Recovered — state verified")
                      }
                      loading={pending === "recover"}
                      disabled={stale}
                      data-testid="cockpit-recover"
                    >
                      Recover engine
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setCompleteOpen(true);
                      }}
                      disabled={stale}
                      data-testid="cockpit-complete"
                    >
                      Complete auction
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* The auctioneer was the only surface without a running record of
              the bidding — owner, spectate and replay all had one. */}
          <Card data-testid="cockpit-bid-feed">
            <div className="competition-head">
              <h2>Bid feed</h2>
              {lot !== null ? (
                <span className="competitions-hint">{lot.lotNumber} on the block</span>
              ) : null}
            </div>
            {lot === null || lot.bidHistory.length === 0 ? (
              <p className="competitions-hint" data-testid="cockpit-bid-feed-empty">
                {lot === null
                  ? "Open a lot and the bidding shows up here."
                  : "Awaiting the first paddle…"}
              </p>
            ) : (
              <ol className="timeline">
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

          <Card data-testid="queue-card">
            <div className="competition-head">
              <h2>Lot queue</h2>
              <span className="competitions-hint">skip &amp; bring-forward</span>
            </div>
            {queue.length === 0 ? (
              <p className="competitions-hint" data-testid="queue-empty">
                No queued lots.
              </p>
            ) : (
              <ol className="cockpit-queue">
                {queue.map((entry) => (
                  <li key={entry.lotId} data-testid={`queue-${entry.lotNumber}`}>
                    <Badge tone="info">{entry.lotNumber}</Badge>
                    <span className="registration-name">{entry.playerName ?? "Unnamed"}</span>
                    <span className="competitions-hint">
                      base {formatPaiseINR(paise(entry.basePrice))}
                    </span>
                    <span className="queue-actions">
                      <Button
                        size="sm"
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
                      >
                        Withdraw
                      </Button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {view.view.lotStats.frozen > 0 || view.view.lotStats.unsold > 0 ? (
              <>
                <h2>Needs resolution</h2>
                <p className="competitions-hint" data-testid="frozen-lot-hint">
                  A frozen lot has a clock that is stopped, not running — including one you have
                  just undone. Requeue it and it goes back to the top of the queue for you to open
                  deliberately.
                </p>
                <ol className="cockpit-queue">
                  {view.view.lots
                    .filter((entry) => entry.status === "frozen" || entry.status === "unsold")
                    .map((entry) => (
                      <li key={entry.id} data-testid={`resolve-${entry.lotNumber}`}>
                        <Badge tone="warning">{entry.lotNumber}</Badge>
                        <span className="registration-name">{entry.playerName ?? "Unnamed"}</span>
                        <span className="competitions-hint">{entry.status}</span>
                        <span className="queue-actions">
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
                        </span>
                      </li>
                    ))}
                </ol>
              </>
            ) : null}
          </Card>
        </div>

        <div className="cockpit-col">
          {/* DA-20: the cockpit rendered no outbound links at ALL, so the two
              surfaces the room and the stream actually watch — the venue board
              and the OBS overlay — had no door anywhere in the product. */}
          <BroadcastLinks slug={slug} />

          <Card data-testid="owners-card">
            <h2>Owners &amp; paddles</h2>
            <p className="competitions-hint">
              Invitation → acceptance → grant → claim. No active paddle without an explicit grant.
            </p>
            {/* P0-2, said where an organizer would look for the control that
                does not exist. `auction_owner_invites.revoked_at` is READ in six
                places and WRITTEN in none: there is no RevokeOwnerInvite command
                in AUCTION_EVENT_TYPES, no engine handler and no control. Both
                live in fenced packages, so this milestone states the gap rather
                than papering over it. */}
            <p className="competitions-hint" data-testid="owner-invite-irrevocable">
              <strong>An owner link cannot be withdrawn once you send it.</strong> There is no
              revoke for owner invitations today — anyone holding the link can accept it, and it
              stays usable until it expires 7 days after minting. Check the number before you send.
            </p>
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
            {finished ? (
              <p className="competitions-hint" data-testid="invite-owner-blocked">
                This auction has ended — there is no owner left to invite.
              </p>
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
                    Send it yourself — the platform sends nothing. It works once and cannot be
                    withdrawn.
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
                          entry.acceptedBy !== null ? "success" : entry.expired ? "danger" : "info"
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
                        <span className="competitions-hint">{describeAcceptor(who)}</span>
                      )}
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
                    <div key={entry.id} className="owner-row" data-testid={`grantable-${entry.id}`}>
                      <span className="registration-name">
                        {who?.name ?? "Unnamed account"}
                        {who === undefined ? null : (
                          <span
                            className="registration-phone"
                            data-testid={`grantable-phone-${entry.id}`}
                          >
                            {formatPhone(who.phone)}
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
                    <span className="registration-name">{entry.personName ?? "Owner"}</span>
                    <span className="competitions-hint">{entry.teamName}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          {snapshot !== null ? <AuctionProgress snapshot={snapshot} /> : null}

          {/* The one purse treatment, shared with the owner room and the
              spectator board. */}
          <PurseBoard snapshot={snapshot} teams={view.teams} />

          <PoolSummary snapshot={snapshot} resolved={view.resolved} preSigned={view.preSigned} />
        </div>
      </div>

      <SquadBoard
        teams={view.teams}
        preSigned={view.preSigned}
        resolved={view.resolved}
        snapshot={snapshot}
        squadMax={view.rules.squadMax}
      />

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
                      for <strong>{formatPaiseINR(paise(undoTarget.amount))}</strong>
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
