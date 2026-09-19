"use client";

import type { TabItem } from "@desiauction/ui";

import { HashTabs } from "../../../components/hash-tabs/hash-tabs";

/**
 * Org Detail tabs, with the active one held in the URL hash (#overview,
 * #tournaments, #members, #money) — see HashTabs for why.
 */
export function OrgTabs({ tabs }: { tabs: TabItem[] }) {
  return <HashTabs tabs={tabs} label="Organization sections" />;
}
