import type { ReactNode } from "react";

import styles from "./page-header.module.css";

/**
 * Page title system (PX-2 shell): every Console page opens with a PageHeader —
 * one h1, optional subtitle, primary actions right-aligned (wrapping under on
 * mobile). SectionHeader carries h2 rows; QuickActionBar groups related
 * actions and becomes a sticky bottom bar under 720px when `sticky` is set.
 */

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Usually Buttons/ButtonLinks — the page's primary actions. */
  actions?: ReactNode;
  /** Breadcrumb slot, rendered above the title. */
  breadcrumb?: ReactNode;
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: PageHeaderProps) {
  return (
    <header className={styles["header"]}>
      {breadcrumb}
      <div className={styles["row"]}>
        <div className={styles["titles"]}>
          <h1 className={styles["title"]}>{title}</h1>
          {subtitle !== undefined ? <p className={styles["subtitle"]}>{subtitle}</p> : null}
        </div>
        {actions !== undefined ? <div className={styles["actions"]}>{actions}</div> : null}
      </div>
    </header>
  );
}

export interface SectionHeaderProps {
  title: string;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
}

export function SectionHeader({ title, actions, headingLevel = 2 }: SectionHeaderProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={styles["section"]}>
      <Heading className={styles["section-title"]}>{title}</Heading>
      {actions !== undefined ? <div className={styles["actions"]}>{actions}</div> : null}
    </div>
  );
}

export interface QuickActionBarProps {
  /** Accessible name for the toolbar. */
  label: string;
  children: ReactNode;
  /** Stick to the viewport bottom under 720px (bulk bars, record forms). */
  sticky?: boolean;
}

export function QuickActionBar({ label, children, sticky = false }: QuickActionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={[styles["quick-actions"], sticky ? styles["sticky"] : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
