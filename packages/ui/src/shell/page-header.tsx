import type { HTMLAttributes, ReactNode } from "react";

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
  /**
   * Extra attributes for the h1 — an id to point `aria-labelledby` at, or a
   * test hook. The heading stays a plain string so pages cannot smuggle a
   * second heading into the document outline.
   */
  titleAttrs?: Omit<HTMLAttributes<HTMLHeadingElement>, "children" | "className"> & {
    // React accepts data-* on any element, but HTMLAttributes does not declare
    // them; the index signature lets callers hang an id or a test hook here.
    [dataAttribute: `data-${string}`]: string | undefined;
  };
}

export function PageHeader({ title, subtitle, actions, breadcrumb, titleAttrs }: PageHeaderProps) {
  return (
    <header className={styles["header"]}>
      {breadcrumb}
      <div className={styles["row"]}>
        <div className={styles["titles"]}>
          <h1 className={styles["title"]} {...titleAttrs}>
            {title}
          </h1>
          {subtitle !== undefined ? <p className={styles["subtitle"]}>{subtitle}</p> : null}
        </div>
        {actions !== undefined ? <div className={styles["actions"]}>{actions}</div> : null}
      </div>
    </header>
  );
}

export interface PageIntroProps {
  /** The line under the title — what this surface is for. */
  subtitle?: ReactNode;
  /** Usually Buttons/ButtonLinks — the page's primary actions. */
  actions?: ReactNode;
}

/**
 * A console page's opening row, minus the title: inside AppShell the `<h1>` is
 * the shell's, up in the identity bar, and a page that printed its own would be
 * saying the same words twice a few pixels apart. Subtitle and actions still
 * belong to the page, so they stay here.
 *
 * `PageHeader` (with its h1) remains correct for the public, live and bare
 * shells, which have no identity bar to inherit a title from.
 */
export function PageIntro({ subtitle, actions }: PageIntroProps) {
  if (subtitle === undefined && actions === undefined) {
    return null;
  }
  return (
    <div className={styles["intro"]}>
      {subtitle !== undefined ? <p className={styles["subtitle"]}>{subtitle}</p> : null}
      {actions !== undefined ? <div className={styles["actions"]}>{actions}</div> : null}
    </div>
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
