"use client";

import { Tabs, type TabItem } from "@desiauction/ui";
import { useSyncExternalStore } from "react";

/**
 * Tabs whose selection lives in the URL hash (#players, #log …), so a reload,
 * a shared link or a back-link lands on the tab that was open.
 *
 * Lifted from the org page (org/[slug]/org-tabs.tsx), where the design note
 * was: without this, opening a desk and clicking the breadcrumb back landed
 * you on the first tab, not the one you left. `history.replaceState` — not
 * push — so the browser's Back still leaves the page rather than cycling tabs.
 *
 * The hash IS the store. `hashchange` covers the address bar, Back/Forward and
 * links; `replaceState` (used on click) fires no event, so a click notifies
 * subscribers itself.
 */
const hashListeners = new Set<() => void>();

function subscribeHash(onChange: () => void): () => void {
  hashListeners.add(onChange);
  window.addEventListener("hashchange", onChange);
  return () => {
    hashListeners.delete(onChange);
    window.removeEventListener("hashchange", onChange);
  };
}

export function writeHash(id: string): void {
  window.history.replaceState(null, "", `#${id}`);
  for (const notify of hashListeners) {
    notify();
  }
}

export function HashTabs({
  tabs,
  label,
  defaultId,
}: {
  tabs: TabItem[];
  /** Accessible name for the tab list. */
  label: string;
  /** The tab shown when the hash names none of them — defaults to the first. */
  defaultId?: string;
}) {
  const ids = tabs.map((tab) => tab.id);
  // The server (and the hydrating render) cannot see the hash, so they show
  // the default tab; the real one takes over as soon as the page is live.
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.replace(/^#/, ""),
    () => "",
  );
  const fallback = defaultId !== undefined && ids.includes(defaultId) ? defaultId : (ids[0] ?? "");
  const active = ids.includes(hash) ? hash : fallback;

  return <Tabs tabs={tabs} label={label} selectedId={active} onSelect={writeHash} />;
}
