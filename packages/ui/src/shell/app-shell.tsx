import type { ElementType, ReactNode } from "react";

import styles from "./app-shell.module.css";
import { BrandGlyph } from "./icons";

/**
 * The Console shell (PX-1 01 §1 S2, 04 §6). Pure presentational: navigation
 * state (active flags) and the link implementation are injected by the app —
 * this package never imports a router. Layout: full-height brand sidebar
 * ≥720px, bottom tab bar <720px, single content container.
 */

export interface ShellNavItem {
  key: string;
  label: string;
  href: string;
  icon?: ReactNode;
  active?: boolean;
  /** Optional count chip (e.g. unread notifications). */
  badge?: number;
}

export interface AppShellProps {
  nav: ShellNavItem[];
  /** Extra groups rendered under the primary rail, each divided from the last. */
  navGroups?: { key: string; label?: string; items: ShellNavItem[] }[];
  /** Injected link renderer (e.g. next/link). Defaults to <a>. */
  linkComponent?: ElementType;
  wordmark: ReactNode;
  wordmarkHref?: string;
  /** Small line under the wordmark in the sidebar (brand tagline). */
  tagline?: ReactNode;
  /** Current surface name, shown at the left of the top bar. */
  pageTitle?: ReactNode;
  /** Search affordance rendered in the middle of the top bar. */
  search?: ReactNode;
  /** Right side of the top bar: bell, user menu. */
  topActions?: ReactNode;
  /** Pinned to the bottom of the sidebar (upgrade card, signed-in user). */
  railFooter?: ReactNode;
  /** Rendered under the top bar — the competition ContextBar slot. */
  contextBar?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  nav,
  navGroups,
  linkComponent: Link = "a",
  wordmark,
  wordmarkHref = "/",
  tagline,
  pageTitle,
  search,
  topActions,
  railFooter,
  contextBar,
  children,
}: AppShellProps) {
  const brand = (
    <Link href={wordmarkHref} className={styles["wordmark"]}>
      <span className={styles["wordmark-glyph"]} aria-hidden>
        <BrandGlyph />
      </span>
      <span className={styles["wordmark-text"]}>{wordmark}</span>
    </Link>
  );
  return (
    <div className={styles["shell"]}>
      <a className={styles["skip"]} href="#main-content">
        Skip to content
      </a>
      {/* Full-height brand sidebar (≥720px): logo atop the navigation. */}
      <NavigationRail label="Primary">
        <div className={styles["rail-brand"]}>
          {brand}
          {tagline !== undefined ? <span className={styles["rail-tagline"]}>{tagline}</span> : null}
        </div>
        <NavigationGroup>
          {nav.map((item) => (
            <NavigationItem key={item.key} item={item} linkComponent={Link} />
          ))}
        </NavigationGroup>
        {(navGroups ?? []).map((group) => (
          <NavigationGroup key={group.key} {...(group.label !== undefined ? { label: group.label } : {})}>
            {group.items.map((item) => (
              <NavigationItem key={item.key} item={item} linkComponent={Link} />
            ))}
          </NavigationGroup>
        ))}
        {railFooter !== undefined ? (
          <div className={styles["rail-footer"]}>{railFooter}</div>
        ) : null}
      </NavigationRail>
      <div className={styles["body"]}>
        <header className={styles["topbar"]}>
          {/* The brand rides the top bar only on mobile, where the rail is hidden. */}
          <div className={styles["topbar-brand"]}>{brand}</div>
          {pageTitle !== undefined ? (
            <h1 className={styles["page-title"]}>{pageTitle}</h1>
          ) : null}
          {search !== undefined ? <div className={styles["topbar-search"]}>{search}</div> : null}
          <div className={styles["top-actions"]}>{topActions}</div>
        </header>
        {contextBar}
        {/* Pages own their <main> landmark; this is the skip-link target. */}
        <div id="main-content" className={styles["content"]} tabIndex={-1}>
          {children}
        </div>
      </div>
      <nav className={styles["bottom-tabs"]} aria-label="Sections">
        {nav.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={[styles["tab"], item.active === true ? styles["tab-active"] : ""]
              .filter(Boolean)
              .join(" ")}
            aria-current={item.active === true ? "page" : undefined}
          >
            <span className={styles["tab-icon"]}>{item.icon}</span>
            <span className={styles["tab-label"]}>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export interface NavigationRailProps {
  label: string;
  children: ReactNode;
}

export function NavigationRail({ label, children }: NavigationRailProps) {
  return (
    <nav className={styles["rail"]} aria-label={label}>
      {children}
    </nav>
  );
}

export interface NavigationGroupProps {
  /** Optional visible group heading (e.g. a future "Admin" cluster). */
  label?: string;
  children: ReactNode;
}

export function NavigationGroup({ label, children }: NavigationGroupProps) {
  return (
    <div className={styles["rail-group"]}>
      {label !== undefined ? <span className={styles["rail-group-label"]}>{label}</span> : null}
      <ul className={styles["rail-list"]}>{children}</ul>
    </div>
  );
}

export interface NavigationItemProps {
  item: ShellNavItem;
  linkComponent?: ElementType;
}

export function NavigationItem({ item, linkComponent: Link = "a" }: NavigationItemProps) {
  return (
    <li>
      <Link
        href={item.href}
        className={[styles["rail-item"], item.active === true ? styles["rail-item-active"] : ""]
          .filter(Boolean)
          .join(" ")}
        aria-current={item.active === true ? "page" : undefined}
      >
        <span className={styles["rail-icon"]}>{item.icon}</span>
        <span className={styles["rail-label"]}>{item.label}</span>
        {item.badge !== undefined && item.badge > 0 ? (
          <span className={styles["rail-badge"]}>{item.badge}</span>
        ) : null}
      </Link>
    </li>
  );
}
