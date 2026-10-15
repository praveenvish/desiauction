"use client";
import { useEffect, useMemo, useReducer } from "react";
import {
  bindScoringActor,
  onScoringStop,
  scoringRead,
  scoringUpdate,
} from "../../../score/storage";
import { onAuctionRecoveryChange, publishAuctionRecovery } from "./recovery-events";
import { AuctionCommands, STORAGE_TIMEOUT_MS } from "./command-runtime";
import { recoveryKey, type RecoveryMarker } from "./command-state";

export function useAuctionCommands(
  actorId: string,
  auctionId: string,
  version: number | null,
  boundaryId = auctionId,
) {
  const [, changed] = useReducer((value: number) => value + 1, 0);
  const commands = useMemo(() => {
    const key = recoveryKey(actorId, boundaryId);
    return new AuctionCommands(
      actorId,
      auctionId,
      {
        read: () => scoringRead<unknown>(key),
        update: async (change) => {
          const result = await scoringUpdate<RecoveryMarker[]>(key, change);
          publishAuctionRecovery({ actorId, boundaryId });
          return result;
        },
      },
      changed,
      boundaryId,
    );
  }, [actorId, auctionId, boundaryId]);
  useEffect(() => {
    let mounted = true;
    commands.begin();
    const unsubscribeRecovery = onAuctionRecoveryChange((scope) => {
      if (
        scope.actorId === actorId &&
        scope.boundaryId === boundaryId &&
        commands.ready &&
        !commands.stopped &&
        !commands.error
      )
        void commands.load(true);
    });
    const unsubscribe = onScoringStop(() => {
      commands.stop();
    });
    // Bidding never waits on browser storage: if the device store cannot be
    // opened (blocked, private or quota-limited browsers) or does not answer,
    // recovery is kept in this tab and every control still works.
    let settled = false;
    const tabOnly = () => {
      if (settled || !mounted || commands.stopped) return;
      settled = true;
      commands.useMemory();
      commands.begin();
      void commands.load();
    };
    const fallback = setTimeout(tabOnly, STORAGE_TIMEOUT_MS);
    void bindScoringActor(actorId)
      .then(async (receipt) => {
        if (settled || !mounted || !receipt.valid()) return;
        settled = true;
        clearTimeout(fallback);
        commands.begin();
        await commands.load();
      })
      .catch(() => {
        clearTimeout(fallback);
        tabOnly();
      });
    return () => {
      mounted = false;
      clearTimeout(fallback);
      unsubscribe();
      unsubscribeRecovery();
      commands.stop();
    };
  }, [actorId, boundaryId, commands]);
  const acceptedVersions = commands.markers
    .filter((marker) => marker.state === "accepted")
    .map((marker) => `${marker.commandId}:${String(marker.acknowledgedVersion)}`)
    .join("|");
  useEffect(() => {
    if (version !== null) void commands.observe(version);
  }, [commands, version, acceptedVersions]);
  return commands;
}
