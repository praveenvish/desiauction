"use client";

import { Tabs, type TabItem } from "@desiauction/ui";
import { useEffect, useRef, useState } from "react";

/**
 * Org Detail tabs, with the active one held in the URL hash.
 *
 * The design's own note: without this, opening a money desk and clicking the
 * breadcrumb back landed you on Overview, not the Money & roles tab you left.
 * The hash (#overview, #tournaments, #members, #money) makes a reload or a
 * back-link keep its place. `history.replaceState` — not push — so the browser
 * Back button still leaves the org rather than cycling tabs.
 */
export function OrgTabs({ tabs }: { tabs: TabItem[] }) {
  const ids = tabs.map((tab) => tab.id);
  const [active, setActive] = useState(ids[0] ?? "");

  /*
   * The hash listener is registered once and must read the CURRENT tab set.
   * `ids` is derived fresh every render, so naming it as a dependency would
   * re-register the listener on every render, and omitting it left the effect
   * closed over the first render's array — which the rule was right to flag
   * even though the set does not change today. A ref is the shape that says
   * "one subscription, latest value" without pretending either of those is
   * false.
   */
  const idsRef = useRef(ids);
  idsRef.current = ids;

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (idsRef.current.includes(id)) {
        setActive(id);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => {
      window.removeEventListener("hashchange", fromHash);
    };
    // Mount only: the tab set is fixed for the life of this page render.
  }, []);

  return (
    <Tabs
      tabs={tabs}
      label="Organization sections"
      selectedId={active}
      onSelect={(id) => {
        setActive(id);
        window.history.replaceState(null, "", `#${id}`);
      }}
    />
  );
}
