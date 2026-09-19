"use client";

import { Tabs, type TabItem } from "@desiauction/ui";
import { useSyncExternalStore } from "react";

/**
 * Org Detail tabs, with the active one held in the URL hash.
 *
 * The design's own note: without this, opening a money desk and clicking the
 * breadcrumb back landed you on Overview, not the Money & roles tab you left.
 * The hash (#overview, #tournaments, #members, #money) makes a reload or a
 * back-link keep its place. `history.replaceState` — not push — so the browser
 * Back button still leaves the org rather than cycling tabs.
 */
/*
 * The hash IS the store. `hashchange` covers the address bar, Back/Forward and
 * links; `replaceState` (used on click so Back still leaves the org) fires no
 * event, so a click notifies subscribers itself.
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

function writeHash(id: string): void {
  window.history.replaceState(null, "", `#${id}`);
  for (const notify of hashListeners) {
    notify();
  }
}

export function OrgTabs({ tabs }: { tabs: TabItem[] }) {
  const ids = tabs.map((tab) => tab.id);
  // The server (and the hydrating render) cannot see the hash, so they show
  // the first tab; the real one takes over as soon as the page is live.
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.replace(/^#/, ""),
    () => "",
  );
  const active = ids.includes(hash) ? hash : (ids[0] ?? "");

  return (
    <Tabs tabs={tabs} label="Organization sections" selectedId={active} onSelect={writeHash} />
  );
}
