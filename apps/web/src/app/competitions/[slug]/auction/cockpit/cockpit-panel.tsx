"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, Button, Card, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { CockpitView } from "../../../../../server/auction/conduct-actions";
import { grantPaddleAction, inviteOwnerAction } from "../../../../../server/auction/owner-actions";
import { submitAuctionCommand } from "../../../../../server/auction/live-actions";
import { CeremonyStage } from "../ceremony-stage";
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
    toast({ title: `Rejected: ${ack.reason ?? "unknown"}`, tone: "danger" });
    return false;
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

      <div className="cockpit-grid">
        <div className="competitions-stack">
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
                  <Button
                    onClick={() =>
                      void send("CloseLot", { lotId: lot.lotId }, "Gavel — lot closed")
                    }
                    loading={busy}
                    data-testid="cockpit-gavel"
                  >
                    Gavel (close lot)
                  </Button>
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
                  variant="danger"
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
                onClick={() => void send("CompleteAuction", {}, "Auction completed")}
                loading={busy}
                data-testid="cockpit-complete"
              >
                Complete auction
              </Button>
            </div>
          </Card>

          <Card data-testid="queue-card">
            <div className="competition-head">
              <h2>Lot queue</h2>
              <span className="competitions-hint">
                open any lot — order control is skip &amp; bring-forward (doc 41)
              </span>
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

        <div className="competitions-stack">
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

          <Card data-testid="purse-card">
            <h2>Purses</h2>
            <ul className="conflict-list">
              {(snapshot?.paddles ?? []).map((paddle) => (
                <li key={paddle.paddleId} data-testid={`purse-${paddle.paddleNumber}`}>
                  <Badge tone={paddle.released ? "neutral" : "info"}>{paddle.paddleNumber}</Badge>
                  <span>{paddle.teamName}</span>
                  <span className="registration-phone">
                    {formatPaiseINR(paise(paddle.purseRemaining))} left
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
