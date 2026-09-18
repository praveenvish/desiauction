"use client";

import { useSyncExternalStore } from "react";

const noSubscription = (): (() => void) => () => undefined;

/**
 * Has this component hydrated? False in the server render and in the render
 * that hydrates it; true from then on (and immediately for a component first
 * mounted on the client).
 *
 * Sixteen panels each hand-rolled this as `useState(false)` plus an effect that
 * set it to true — a pattern React's own lint calls out, because the effect
 * schedules a second render purely to flip a boolean the framework already
 * knows. `useSyncExternalStore` with distinct server and client snapshots is
 * the primitive built for exactly this question, and gives the same answer
 * without the extra render. The surfaces use it for `data-hydrated`, which the
 * e2e suite waits on before interacting.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * The page's origin (`https://desiauction.in`) — empty in the server render and
 * the hydrating render, the real value after. Share and broadcast links build on
 * it; the origin is never known on the server behind a proxy, and never changes
 * for the life of a document, so there is nothing to subscribe to.
 */
export function useOrigin(): string {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => "",
  );
}

/** This page's address without its query or fragment; empty until hydrated. */
export function usePageAddress(): string {
  return useSyncExternalStore(
    noSubscription,
    () => `${window.location.origin}${window.location.pathname}`,
    () => "",
  );
}
