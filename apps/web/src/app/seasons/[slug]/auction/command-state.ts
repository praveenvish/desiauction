import { isTransportCommandId, type CommandAck } from "@desiauction/core";

export type CommandOutcome =
  | { kind: "accepted"; ack: CommandAck }
  | { kind: "refused"; ack: CommandAck }
  | { kind: "unknown"; message: string }
  | { kind: "not-started"; message: string };

export function commandOutcome(value: unknown, commandId: string): CommandOutcome {
  if (!value || typeof value !== "object")
    return { kind: "unknown", message: "The auction returned an unreadable answer." };
  const ack = value as Partial<CommandAck>;
  if (
    ack.commandId !== commandId ||
    typeof ack.accepted !== "boolean" ||
    !Number.isSafeInteger(ack.version) ||
    (ack.version ?? -1) < 0 ||
    (ack.reason !== undefined && typeof ack.reason !== "string") ||
    (!ack.accepted && (typeof ack.reason !== "string" || ack.reason.length === 0))
  )
    return { kind: "unknown", message: "The auction answer could not be verified." };
  if (
    !ack.accepted &&
    (ack.reason === "engine_unreachable" ||
      ack.reason === "command_failed" ||
      ack.reason?.startsWith("engine_http_"))
  )
    return { kind: "unknown", message: "The auction has not confirmed this command's outcome." };
  return { kind: ack.accepted ? "accepted" : "refused", ack: ack as CommandAck };
}

/** Client conflicts only; the engine still owns legality and command ordering. */
export function commandResources(type: string, payload: Record<string, unknown>): string[] {
  if (["StartPractice", "RunPracticeAgain", "EndPracticeLifecycle"].includes(type))
    return ["practice-lifecycle"];
  if (type === "PlaceBid") return ["bidding"];
  if (["PauseAuction", "ResumeAuction"].includes(type)) return ["clock"];
  if (type === "RecoverAuction") return ["recovery"];
  if (["CompleteAuction", "AbortAuction", "EndPractice"].includes(type)) return ["end-auction"];
  if (["OpenLot", "CloseLot", "HoldLot", "UndoLastAction", "UndoHoldChain"].includes(type))
    return ["current-lot"];
  if (["RequeueLot", "WithdrawLot"].includes(type)) return [`lot:${String(payload["lotId"])}`];
  if (["ClaimPaddle", "ReleasePaddle", "IssuePaddle"].includes(type))
    return [`paddle:${String(payload["teamId"])}`];
  return [type];
}

export function commandsConflict(a: readonly string[], b: readonly string[]): boolean {
  const safety = (resources: readonly string[]) =>
    resources.every((item) => item === "clock" || item === "recovery");
  if (a.includes("end-auction") && !safety(b)) return true;
  if (b.includes("end-auction") && !safety(a)) return true;
  return a.some((item) => b.includes(item));
}

/** Shared storage boundary, but conflicts and acknowledgement remain exact-room scoped. */
export function reservationConflict(
  request: {
    type: string;
    context: Record<string, unknown>;
    auctionId: string;
    resources: readonly string[];
  },
  other: RecoveryMarker,
): boolean {
  const lifecycle = request.resources.includes("practice-lifecycle");
  const otherLifecycle = other.resources.includes("practice-lifecycle");
  if (lifecycle && otherLifecycle) return true;
  if (lifecycle || otherLifecycle) {
    const termination = lifecycle ? request : other;
    const ordinary = lifecycle ? other : request;
    const target = termination.context["practiceId"];
    return (
      typeof target === "string" &&
      target === ordinary.auctionId &&
      commandsConflict(["end-auction"], ordinary.resources)
    );
  }
  return (
    request.auctionId === other.auctionId && commandsConflict(request.resources, other.resources)
  );
}

export interface RecoveryMarker {
  v: 1;
  commandId: string;
  actorId: string;
  auctionId: string;
  boundaryId?: string;
  control: string;
  type: string;
  resources: string[];
  context: Record<string, string | number | boolean>;
  state: "prepared" | "unknown" | "accepted" | "reviewed";
  acknowledgedVersion: number | null;
  createdAt: string;
  batch?: { targets: string[]; accepted: string[] };
  lifecycle?: { stage: "before-write" | "end" | "create" | "complete"; ended: boolean };
}

export const recoveryKey = (actorId: string, auctionId: string) =>
  `ls1:auction-recovery:v1:${actorId}:${auctionId}`;

/** Never retain invitation tokens or arbitrary payload fields. No replay payload is stored. */
export function recoveryContext(payload: Record<string, unknown>): RecoveryMarker["context"] {
  const context: RecoveryMarker["context"] = {};
  for (const key of [
    "lotId",
    "teamId",
    "paddleId",
    "amountRaw",
    "overrideSquadMinimum",
    "reason",
    "practiceId",
    "realAuctionId",
    "perTeam",
  ]) {
    const value = payload[key];
    if (typeof value === "string" || typeof value === "boolean" || typeof value === "number")
      context[key] = value;
  }
  return context;
}

export function recoveryMarkers(
  value: unknown,
  actorId: string,
  auctionId: string,
): RecoveryMarker[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Auction recovery records could not be read.");
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Auction recovery record is damaged.");
    const marker = item as Partial<RecoveryMarker>;
    if (
      marker.v !== 1 ||
      marker.actorId !== actorId ||
      typeof marker.auctionId !== "string" ||
      (marker.boundaryId ?? marker.auctionId) !== auctionId ||
      typeof marker.commandId !== "string" ||
      !isTransportCommandId(marker.commandId) ||
      typeof marker.control !== "string" ||
      typeof marker.type !== "string" ||
      typeof marker.createdAt !== "string" ||
      !Array.isArray(marker.resources) ||
      !marker.resources.every((resource: unknown) => typeof resource === "string") ||
      JSON.stringify(marker.resources) !==
        JSON.stringify(commandResources(marker.type ?? "", marker.context ?? {})) ||
      (marker.state === "accepted" && marker.acknowledgedVersion === null) ||
      !["prepared", "unknown", "accepted", "reviewed"].includes(marker.state ?? "") ||
      !marker.context ||
      typeof marker.context !== "object" ||
      (marker.acknowledgedVersion !== null &&
        (!Number.isSafeInteger(marker.acknowledgedVersion) ||
          (marker.acknowledgedVersion ?? -1) < 0))
    )
      throw new Error("Auction recovery record is damaged or belongs to another account or room.");
    const allowed = recoveryContext(marker.context);
    if (JSON.stringify(allowed) !== JSON.stringify(marker.context))
      throw new Error("Auction recovery context contains unsupported fields.");
    if (
      marker.lifecycle &&
      (!["before-write", "end", "create", "complete"].includes(marker.lifecycle.stage) ||
        typeof marker.lifecycle.ended !== "boolean" ||
        !marker.resources.includes("practice-lifecycle"))
    )
      throw new Error("Practice recovery stage is damaged.");
    if (
      marker.batch &&
      (!Array.isArray(marker.batch.targets) ||
        !Array.isArray(marker.batch.accepted) ||
        !marker.batch.targets.every((id: unknown) => typeof id === "string") ||
        !marker.batch.accepted.every(
          (id: unknown) => typeof id === "string" && marker.batch?.targets.includes(id),
        ))
    )
      throw new Error("Auction batch recovery record is damaged.");
  }
  return value as RecoveryMarker[];
}

/** Release only a reviewed interlock. Never convert an unknown into a refusal. */
export function reviewedMarkers(markers: readonly RecoveryMarker[], commandId: string) {
  return markers.map((marker) =>
    marker.commandId === commandId ? { ...marker, state: "reviewed" as const } : marker,
  );
}
