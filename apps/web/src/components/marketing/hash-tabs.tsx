"use client";

import { Tabs, type TabItem } from "@desiauction/ui";
import { useEffect, useState } from "react";

/**
 * The Tabs primitive with an address. A tab strip that forgets which panel
 * was open the moment the link is shared is a tab strip nobody can point at,
 * so the selected panel rides in the URL fragment: `/features#the-live-auction`
 * opens on that panel, and choosing one rewrites the fragment in place
 * (replaceState — a choice, not a navigation, so Back leaves the page).
 *
 * The server renders the first tab; the fragment is read after hydration, so
 * the first paint is byte-identical on both sides and only then moves.
 */
export function HashTabs({ tabs, label }: { tabs: TabItem[]; label: string }) {
  const first = tabs[0]?.id ?? "";
  const [selected, setSelected] = useState(first);

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (id !== "" && tabs.some((tab) => tab.id === id)) {
        setSelected(id);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => {
      window.removeEventListener("hashchange", fromHash);
    };
  }, [tabs]);

  return (
    <Tabs
      label={label}
      tabs={tabs}
      selectedId={selected}
      onSelect={(id) => {
        setSelected(id);
        window.history.replaceState(null, "", `#${id}`);
      }}
    />
  );
}
