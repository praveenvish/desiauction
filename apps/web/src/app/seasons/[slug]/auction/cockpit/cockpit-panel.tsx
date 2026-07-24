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
import { GavelButton, type GavelHandle } from "./gavel-button";
import type { CockpitView } from "../../../../../server/auction/conduct-actions";
import { grantPaddleAction, inviteOwnerAction } from "../../../../../server/auction/owner-actions";
import { submitAuctionCommand } from "../../../../../server/auction/live-actions";
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

export function CockpitPanel({ slug, view }: { slug: string; view: CockpitView }) {
  const router = useRouter();
  const toast = useToast();
  const { snapshot, connection, remainingMs, ceremony } = useAuctionSocket(view.wsUrl);
  const [busy, setBusy] = useState(false);
  const [inviteTeam, setInviteTeam] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const send = async (type: string, payload: Record<string, unknown>, done?: string) => {
    setBusy(true);
    const ack = await submitAuctionCommand(slug, commandId(), type, payload);
    setBusy(false);
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
    const ack = await submitAuctionCommand(slug, commandId(), "CompleteAuction", payload);
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

  const invite = async () => {
    setBusy(true);
    const result = await inviteOwnerAction(slug, inviteTeam);
    setBusy(false);
    if (result.ok) {
      setInviteUrl(`${window.location.origin}${result.joinPath}`);
      toast({ title: "Owner invitation minted — forward the link.", tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error, tone: "danger" });
    }
  };

  const grant = async (teamId: string, personId: string) => {
    setBusy(true);
    const result = await grantPaddleAction(slug, teamId, personId);
    setBusy(false);
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
          void send("OpenLot", { lotId: next.lotId }, `${next.lotNumber} on the block`);
        }
      } else if (action === "toggle-pause") {
        void (status === "paused"
          ? send("ResumeAuction", {}, "Resumed")
          : send("PauseAuction", {}, "Paused"));
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
    // closes over only stable values (slug prop, router, toast, setBusy), so it
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
      <StatusRibbon snapshot={snapshot} connection={connection} remainingMs={remainingMs} />
      <AuctionProgress snapshot={snapshot} />

      <div className="cockpit-grid">
        <div className="cockpit-col">
          <CeremonyStage snapshot={snapshot} ceremony={ceremony} remainingMs={remainingMs} />

          <Card data-testid="conduct-card">
            <h2>Conduct</h2>
            <div className="cockpit-actions">
              {status === "scheduled" ? (
                <Button
                  onClick={() => void send("OpenAuction", {}, "Auction opened")}
                  loading={busy}
                  data-testid="cockpit-open-auction"
                >
                  Open auction
                </Button>
              ) : null}
              {status === "live" ? (
                <Button
                  variant="secondary"
                  onClick={() => void send("PauseAuction", {}, "Paused")}
                  loading={busy}
                  data-testid="cockpit-pause"
                >
                  Pause
                </Button>
              ) : null}
              {status === "paused" ? (
                <Button
                  onClick={() => void send("ResumeAuction", {}, "Resumed")}
                  loading={busy}
                  data-testid="cockpit-resume"
                >
                  Resume
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => void send("QueueLots", {}, "Lots queued")}
                loading={busy}
                data-testid="cockpit-queue-lots"
              >
                Queue lots
              </Button>
              {lot !== null ? (
                <>
                  {/* v1.1 G2: closing a lot is a HOLD, not a click. */}
                  <GavelButton
                    ref={gavelRef}
                    disabled={busy}
                    onConfirm={() => {
                      void send("CloseLot", { lotId: lot.lotId }, "Gavel — lot closed");
                    }}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => void send("HoldLot", { lotId: lot.lotId }, "Lot frozen")}
                    loading={busy}
                    data-testid="cockpit-freeze"
                  >
                    Freeze lot
                  </Button>
                </>
              ) : null}
              {view.viewer.canOverride ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void send("UndoLastAction", {}, "Undone — compensating event appended")
                  }
                  loading={busy}
                  data-testid="cockpit-undo"
                >
                  Undo last action
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => void send("RecoverAuction", {}, "Recovered — state verified")}
                loading={busy}
                data-testid="cockpit-recover"
              >
                Recover engine
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setCompleteOpen(true);
                }}
                loading={busy}
                data-testid="cockpit-complete"
              >
                Complete auction
              </Button>
            </div>
            {/* v1.1 G1: shortcuts are discoverable, not folklore. */}
            <p className="cockpit-keys" id="cockpit-gavel-hint" data-testid="cockpit-shortcuts">
              {COCKPIT_SHORTCUTS.map((shortcut) => (
                <span key={shortcut.keys}>
                  <kbd>{shortcut.keys}</kbd> {shortcut.label}
                </span>
              ))}
            </p>
          </Card>

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
                            "OpenLot",
                            { lotId: entry.lotId },
                            `${entry.lotNumber} on the block`,
                          )
                        }
                        loading={busy}
                        disabled={lot !== null}
                        data-testid={`open-${entry.lotNumber}`}
                      >
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void send(
                            "WithdrawLot",
                            { lotId: entry.lotId },
                            `${entry.lotNumber} withdrawn`,
                          )
                        }
                        loading={busy}
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
                                "RequeueLot",
                                { lotId: entry.id },
                                `${entry.lotNumber} requeued`,
                              )
                            }
                            loading={busy}
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
          <Card data-testid="owners-card">
            <h2>Owners &amp; paddles</h2>
            <p className="competitions-hint">
              Invitation → acceptance → grant → claim. No active paddle without an explicit grant.
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
                loading={busy}
                disabled={inviteTeam === ""}
                data-testid="invite-owner"
              >
                Invite owner
              </Button>
            </div>
            {inviteUrl !== null ? (
              <p className="owner-url" data-testid="owner-invite-url">
                {inviteUrl}
              </p>
            ) : null}

            {view.owners.invites.length > 0 ? (
              <div data-testid="owner-invites">
                {view.owners.invites.map((entry) => (
                  <div key={entry.id} className="owner-row" data-testid={`invite-row-${entry.id}`}>
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
                    {entry.acceptedByName !== null ? (
                      <span className="competitions-hint">{entry.acceptedByName}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {grantable.length > 0 ? (
              <>
                <h2>Ready to grant</h2>
                {grantable.map((entry) => (
                  <div key={entry.id} className="owner-row" data-testid={`grantable-${entry.id}`}>
                    <span className="registration-name">{entry.acceptedByName ?? "Owner"}</span>
                    <span className="competitions-hint">{entry.teamName}</span>
                    <Button
                      size="sm"
                      onClick={() => void grant(entry.teamId, entry.acceptedBy ?? "")}
                      loading={busy}
                      data-testid={`grant-${entry.teamId}`}
                    >
                      Grant paddle
                    </Button>
                  </div>
                ))}
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
              loading={busy}
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
