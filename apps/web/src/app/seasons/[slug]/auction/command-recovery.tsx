"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@desiauction/ui";
import "./command-recovery.css";
import type { AuctionCommands } from "./command-runtime";
import { auctionRecoveryContext } from "../../../../server/auction/live-actions";

const actionNames: Record<string, string | undefined> = {
  EndPractice: "End practice",
  PlaceBid: "Raise bid",
  CloseLot: "Close player bidding",
  OpenLot: "Open player bidding",
  HoldLot: "Hold player bidding",
  UndoLastAction: "Undo the last outcome",
  QueueLots: "Queue players",
  RequeueLot: "Requeue player",
  WithdrawLot: "Withdraw player",
  CompleteAuction: "Finish auction",
  PauseAuction: "Pause auction",
  ResumeAuction: "Resume auction",
  OpenAuction: "Open auction",
  RecoverAuction: "Recover auction",
  ClaimPaddle: "Claim paddle",
  ReleasePaddle: "Return paddle",
};

export function CommandRecovery({
  commands,
  slug,
  currentRoom,
}: {
  commands: AuctionCommands;
  slug: string;
  currentRoom: (minimumVersion: number) => boolean;
}) {
  const [checking, setChecking] = useState<string | null>(null);
  const room = useRef(currentRoom);
  useEffect(() => {
    room.current = currentRoom;
  }, [currentRoom]);
  if (commands.stopped)
    return <p role="alert">This account session ended. Sign in before continuing.</p>;
  if (!commands.ready && !commands.error) return <p role="status">Opening auction recovery…</p>;
  const markers = commands.markers.filter(
    (marker) =>
      marker.auctionId === commands.auctionId &&
      marker.state !== "reviewed" &&
      !marker.resources.includes("practice-lifecycle"),
  );
  const exceptional =
    !!commands.error ||
    markers.some(
      (marker) =>
        marker.state !== "accepted" &&
        !(
          marker.state === "prepared" &&
          (commands.isCommandPending(marker.commandId) ||
            (marker.type === "UndoHoldChain" && commands.isChainActive(marker.commandId)))
        ),
    );
  const correcting = markers.some(
    (marker) => marker.type === "UndoHoldChain" && commands.isChainActive(marker.commandId),
  );
  const waiting = markers.some((marker) => marker.state === "prepared");
  const presentation = exceptional
    ? "exception"
    : correcting
      ? "correction"
      : waiting
        ? "pending"
        : markers.length
          ? "accepted"
          : "idle";
  const compact = (
    <div
      className="auction-command-status"
      data-testid="auction-command-status"
      data-presentation={presentation}
      data-command-states={JSON.stringify(
        markers.map((marker) => ({
          id: marker.commandId,
          state: marker.state,
          active: commands.isCommandPending(marker.commandId),
          chainActive: commands.isChainActive(marker.commandId),
        })),
      )}
      role="status"
      aria-atomic="true"
    >
      <span className="auction-command-status-reserve" aria-hidden="true">
        Waiting for the auction’s answer.
      </span>
      <span className="auction-command-status-reserve" aria-hidden="true">
        Command accepted. Waiting for the room to update.
      </span>
      <span className="auction-command-status-reserve" aria-hidden="true">
        Correction in progress. Lot hold not yet confirmed.
      </span>
      <span>
        {exceptional
          ? null
          : correcting
            ? "Correction in progress. Lot hold not yet confirmed."
            : waiting
              ? "Waiting for the auction’s answer."
              : markers.length
                ? "Command accepted. Waiting for the room to update."
                : null}
      </span>
    </div>
  );
  // No device storage — every control works, recovery lives in this tab.
  const tabOnly = commands.degraded ? (
    <p className="auction-command-status-note" role="status">
      Recovery isn’t saved on this device. Keep this tab open while the auction runs.
    </p>
  ) : null;
  if (!exceptional)
    return (
      <>
        {compact}
        {tabOnly}
      </>
    );
  return (
    <>
      {compact}
      {tabOnly}
      <section
        className="auction-recovery-card"
        aria-label="Auction command recovery"
        data-testid="auction-command-recovery"
      >
        <h2>Auction action status</h2>
        {commands.error ? (
          <div role="alert">
            <p>{commands.error}</p>
            <Button
              variant="secondary"
              onClick={() => {
                void commands.load();
              }}
            >
              Check recovery storage
            </Button>
          </div>
        ) : null}
        {markers.map((marker) => (
          <div key={marker.commandId}>
            <p role="status">
              {marker.state === "accepted"
                ? "Command accepted. Waiting for the room to show its acknowledged state."
                : marker.state === "prepared" &&
                    marker.type === "UndoHoldChain" &&
                    commands.isChainActive(marker.commandId)
                  ? "Correction in progress. Lot hold not yet confirmed."
                  : marker.state === "prepared" && commands.isCommandPending(marker.commandId)
                    ? "Waiting for the auction’s answer."
                    : "Command outcome unknown. Review the current bid feed, lot and purse before another action."}
            </p>
            <p>
              {actionNames[marker.type] ?? "Auction action"}. This action will not be sent again
              automatically.
            </p>
            {marker.batch ? (
              <p>
                {marker.batch.accepted.length} of {marker.batch.targets.length} players acknowledged
                as requeued before this item.
              </p>
            ) : null}
            {marker.state === "accepted" ? null : (
              <Button
                variant="secondary"
                disabled={!!checking || commands.pending(marker.control)}
                loading={checking === marker.commandId}
                onClick={() => {
                  setChecking(marker.commandId);
                  void commands
                    .review(marker.commandId, async () => {
                      const context = await auctionRecoveryContext(slug, commands.auctionId);
                      return (
                        context?.personId === commands.actorId &&
                        context.auctionId === commands.auctionId &&
                        room.current(context.version)
                      );
                    })
                    .finally(() => {
                      setChecking(null);
                    });
                }}
              >
                Reviewed current room · allow a new action
              </Button>
            )}
          </div>
        ))}
        <p>
          After review, you may start a new action on this device. The earlier action may still
          complete.
        </p>
      </section>
    </>
  );
}
