"use client";
/** Notifications carry scope identity only; persisted storage remains the source of truth. */
type Scope = { actorId: string; boundaryId: string };
const listeners = new Set<(scope: Scope) => void>();
let channel: BroadcastChannel | undefined;
function open() {
  if (!channel && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("da-auction-recovery");
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (!value || typeof value !== "object") return;
      const scope = value as Partial<Scope>;
      if (typeof scope.actorId !== "string" || typeof scope.boundaryId !== "string") return;
      for (const listener of listeners) listener(scope as Scope);
    };
  }
}
export function onAuctionRecoveryChange(listener: (scope: Scope) => void) {
  open();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function publishAuctionRecovery(scope: Scope) {
  open();
  for (const listener of listeners) listener(scope);
  channel?.postMessage(scope);
}
