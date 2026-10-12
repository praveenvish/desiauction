"use client";
import { useEffect, useMemo, useReducer } from "react";
import {
  bindScoringActor,
  onScoringStop,
  scoringRead,
  scoringUpdate,
} from "../../../score/storage";
import { onAuctionRecoveryChange, publishAuctionRecovery } from "./recovery-events";
import { AuctionCommands } from "./command-runtime";
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
    void bindScoringActor(actorId)
      .then(async (receipt) => {
        if (mounted && receipt.valid()) {
          commands.begin();
          await commands.load();
        }
      })
      .catch(() => {
        if (mounted && !commands.stopped) {
          commands.error = "Recovery storage could not be opened. No command will be sent.";
          changed();
        }
      });
    return () => {
      mounted = false;
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
