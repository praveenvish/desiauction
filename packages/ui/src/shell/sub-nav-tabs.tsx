import type { ElementType, ReactNode } from "react";

import styles from "./sub-nav-tabs.module.css";

/**
 * ContextBar + SubNavTabs (PX-1 04 §6): the competition context header. Unlike
 * the ARIA `Tabs` primitive (in-page panels), these are NAVIGATION links styled
 * as tabs — each tab is a route. Attention dots are counts or booleans from the
 * phase engine, passed in as data.
 */

export interface SubNavTab {
  key: string;
  label: string;
  href: string;
  active?: boolean;
  /** Attention dot: true for a plain dot, a number for a count pill. */
  attention?: boolean | number;
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

export interface ContextBarProps {
  /** Breadcrumb slot. */
  breadcrumb?: ReactNode;
  /** Right side: switchers, context actions. */
  actions?: ReactNode;
  /** SubNavTabs slot. */
  tabs?: ReactNode;
}

export function ContextBar({ breadcrumb, actions, tabs }: ContextBarProps) {
  return (
    <div className={styles["context-bar"]}>
      <div className={styles["context-row"]}>
        {breadcrumb}
        {actions !== undefined ? <div className={styles["context-actions"]}>{actions}</div> : null}
      </div>
      {tabs}
    </div>
  );
}
