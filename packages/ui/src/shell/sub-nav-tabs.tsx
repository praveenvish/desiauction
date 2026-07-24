import type { ElementType } from "react";

import styles from "./sub-nav-tabs.module.css";

/**
 * SubNavTabs (PX-1 04 §6): a surface's section navigation. Unlike the ARIA
 * `Tabs` primitive (in-page panels), these are NAVIGATION links styled as tabs —
 * each tab is a route. Attention dots are counts or booleans from the phase
 * engine, passed in as data.
 *
 * It renders into AppShell's `tabs` slot. The ContextBar that used to wrap it —
 * a second bar carrying breadcrumb and switchers — is gone: both moved up into
 * the identity bar, where every surface has them, not just this one.
 */

export interface SubNavTab {
  key: string;
  label: string;
  href: string;
  active?: boolean;
  /** Attention dot: true for a plain dot, a number for a count pill. */
  attention?: boolean | number;
  /** Test hook, for when a tab IS the navigation affordance a suite drives. */
  testId?: string;
}

export interface SubNavTabsProps {
  label: string;
  tabs: SubNavTab[];
  linkComponent?: ElementType;
}

export function SubNavTabs({ label, tabs, linkComponent: Link = "a" }: SubNavTabsProps) {
  return (
    <nav aria-label={label} className={styles["tabs"]}>
      <ul className={styles["list"]}>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              className={[styles["tab"], tab.active === true ? styles["active"] : ""]
                .filter(Boolean)
                .join(" ")}
              aria-current={tab.active === true ? "page" : undefined}
              {...(tab.testId !== undefined ? { "data-testid": tab.testId } : {})}
            >
              {tab.label}
              {tab.attention !== undefined && tab.attention !== false && tab.attention !== 0 ? (
                <span className={styles["dot"]} aria-label="needs attention">
                  {typeof tab.attention === "number" ? tab.attention : ""}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
