import type { ElementType, HTMLAttributes, ReactNode } from "react";

import styles from "./app-shell.module.css";
import { BrandGlyph } from "./icons";

/**
 * The Console shell (PX-1 01 §1 S2, 04 §6). Pure presentational: navigation
 * state (active flags) and the link implementation are injected by the app —
 * this package never imports a router. Layout: full-height brand sidebar
 * ≥720px, bottom tab bar <720px, single content container.
 *
 * The top bar is the IDENTITY bar: breadcrumb over the page's one `<h1>`, with
 * the utility cluster on the right. It replaced a bar that spent its middle on
 * a search field while identity sat in a second bar below and a third copy of
 * the same words opened the page — the title now has exactly one home, and it
 * is the same one on every console surface.
 */

export interface ShellNavItem {
  key: string;
  label: string;
  href: string;
  icon?: ReactNode;
  active?: boolean;
  /** Optional count chip (e.g. unread notifications). */
  badge?: number;
  /** A test hook on the link (the season sections carry `open-teams` and co.). */
  testId?: string;
  /** Happening now (an auction in progress): a LIVE marker instead of a count. */
  live?: boolean;
  /**
   * `false`: rail only. The phone's bottom tab bar has room for five, so the
   * rest ride the app's drawer instead of squeezing every label unreadable.
   */
  mobile?: boolean;
}

export interface AppShellProps {
  nav: ShellNavItem[];
  /** Extra groups rendered under the primary rail, each divided from the last. */
  navGroups?: { key: string; label?: string; items: ShellNavItem[] }[];
  /** Injected link renderer (e.g. next/link). Defaults to <a>. */
  linkComponent?: ElementType;
  wordmark: ReactNode;
  wordmarkHref?: string;
  /** The mark rendered in the wordmark chip. Defaults to the built-in glyph so
      packages/ui carries no asset of its own; the app passes the real logo. */
  glyph?: ReactNode;
  /** Small line under the wordmark in the sidebar (brand tagline). */
  tagline?: ReactNode;
  /**
   * The page's title — rendered as the document's one `<h1>`, in the top bar.
   * Pages under this shell must not render an h1 of their own.
   */
  pageTitle?: ReactNode;
  /** Extra attributes for that h1 (a test hook, an id to point aria at). */
  pageTitleAttrs?: Omit<HTMLAttributes<HTMLHeadingElement>, "children" | "className"> & {
    [dataAttribute: `data-${string}`]: string | undefined;
  };
  /** Small adornments beside the title — a status badge, a live pill. */
  titleStatus?: ReactNode;
  /** Trail under the title. Absent on rail-root surfaces, which have no parent. */
  breadcrumb?: ReactNode;
  /** What the surface is for — line two where there is no trail to show. */
  subtitle?: ReactNode;
  /**
   * The page's ONE primary action, rendered at the head of the utility cluster.
   * Every surface's "do the main thing" button then lives in the same place
   * instead of floating somewhere different on each page.
   */
  pageAction?: ReactNode;
  /**
   * Left of the top bar: where you are — the club and season switchers and the
   * season's status. The page's title is no longer up here; it opens the page.
   */
  context?: ReactNode;
  /** Right side of the top bar: search, theme, bell, user menu. */
  topActions?: ReactNode;
  /** Pinned to the bottom of the sidebar (upgrade card, signed-in user). */
  railFooter?: ReactNode;
  /** Section tabs, rendered as their own sticky strip under the top bar. */
  tabs?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  nav,
  navGroups,
  linkComponent: Link = "a",
  wordmark,
  wordmarkHref = "/",
  glyph = <BrandGlyph />,
  tagline,
  pageTitle,
  pageTitleAttrs,
  titleStatus,
  breadcrumb,
  subtitle,
  pageAction,
  context,
  topActions,
  railFooter,
  tabs,
  children,
}: AppShellProps) {
  const brand = (
    <Link href={wordmarkHref} className={styles["wordmark"]}>
      <span className={styles["wordmark-glyph"]} aria-hidden>
        {glyph}
      </span>
      <span className={styles["wordmark-text"]}>{wordmark}</span>
    </Link>
  );
  /**
   * The rail's lockup. The tagline is nested in a column WITH the wordmark
   * rather than placed under the whole link, so its edges are the wordmark's by
   * construction — an offset measured in pixels drifts the moment the glyph's
   * border or size changes, which is exactly how it ended up 2px adrift.
   */
  const railBrand = (
    <Link href={wordmarkHref} className={styles["wordmark"]}>
      <span className={styles["wordmark-glyph"]} aria-hidden>
        {glyph}
      </span>
      <span className={styles["wordmark-stack"]}>
        <span className={styles["wordmark-text"]}>{wordmark}</span>
        {/* aria-hidden: the wordmark above already names the product, so a
            reader announcing "DesiAuction, Bid dot Build dot Win" on every page
            is repeating the brand at the cost of the reader's time. It is a
            mark, not information. */}
        {tagline !== undefined ? (
          <span className={styles["rail-tagline"]} aria-hidden>
            {tagline}
          </span>
        ) : null}
      </span>
    </Link>
  );
  /*
   * WHERE THE TITLE LIVES. Inside a season the top bar says where you are (the
   * season, its status) and the page opens with its own title — "Teams",
   * "Auction results". On a surface with no such context (Home, the lists
   * under the rail) the title IS the context, so it stays in the bar, with
   * the page's main button beside it.
   */
  const titleInBar = context === undefined;
  const identityBlock = (
    <div className={styles["identity"]}>
      {pageTitle !== undefined ? (
        <div className={styles["identity-title"]}>
          <h1 className={styles["page-title"]} {...pageTitleAttrs}>
            {pageTitle}
          </h1>
          {titleStatus}
        </div>
      ) : null}
      {/* In the bar there is room for one line under the title: the trail
          where the surface has ancestors, its lede where it does not. */}
      {titleInBar && breadcrumb !== undefined ? (
        <div className={styles["identity-trail"]}>{breadcrumb}</div>
      ) : subtitle !== undefined ? (
        <p className={styles["identity-lede"]}>{subtitle}</p>
      ) : null}
    </div>
  );
  const actionBlock =
    pageAction !== undefined ? (
      <div className={styles["page-action"]} data-page-action>
        {pageAction}
      </div>
    ) : null;
  return (
    // The console's own surface: quieter primitives (an ink primary instead of
    // the marketing gold) key on this, so public and live shells are untouched.
    <div className={styles["shell"]} data-surface="console">
      <a className={styles["skip"]} href="#main-content">
        Skip to content
      </a>
      {/* Full-height brand sidebar (≥720px): logo atop the navigation. */}
      <NavigationRail label="Primary">
        <div className={styles["rail-brand"]}>{railBrand}</div>
        <NavigationGroup>
          {nav.map((item) => (
            <NavigationItem key={item.key} item={item} linkComponent={Link} />
          ))}
        </NavigationGroup>
        {(navGroups ?? []).map((group) => (
          <NavigationGroup
            key={group.key}
            {...(group.label !== undefined ? { label: group.label } : {})}
          >
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
          <div className={styles["topbar-inner"]}>
            {/* The brand rides the top bar only on mobile, where the rail is hidden. */}
            <div className={styles["topbar-brand"]}>{brand}</div>
            {titleInBar ? (
              <>
                {identityBlock}
                {actionBlock}
              </>
            ) : (
              <div className={styles["context"]}>{context}</div>
            )}
            <div className={styles["top-actions"]}>{topActions}</div>
          </div>
        </header>
        {tabs !== undefined ? (
          <div className={styles["tabbar"]}>
            <div className={styles["tabbar-inner"]}>{tabs}</div>
          </div>
        ) : null}
        {/* Pages own their <main> landmark; this is the skip-link target. */}
        <div id="main-content" className={styles["content"]} tabIndex={-1}>
          {/* THE PAGE HEAD. Trail, then the page's one <h1> with its status,
              then what the surface is for — and the page's primary action on
              the right. It opens the page instead of hiding in the top bar,
              so every console surface starts the same way. */}
          {!titleInBar &&
          (pageTitle !== undefined || breadcrumb !== undefined || pageAction !== undefined) ? (
            <div className={styles["page-head"]}>
              {breadcrumb !== undefined ? (
                <div className={styles["identity-trail"]}>{breadcrumb}</div>
              ) : null}
              <div className={styles["page-head-row"]}>
                {identityBlock}
                {actionBlock}
              </div>
            </div>
          ) : null}
          {children}
        </div>
      </div>
      {/* "Primary", not "Sections". This is the SAME navigation as the desktop
          rail (NavigationRail label="Primary", above) — it maps the same `nav`
          prop, so the same items and the same destinations — laid out as bottom
          tabs because the viewport is narrow. Naming it differently gave a
          screen-reader user two names
          for one landmark depending on the width of their screen, and made
          "the primary navigation" unfindable on a phone: responsive.spec.ts
          searches for nav[name="Primary"] at 320px and found nothing at all.
          "Sections" was also simply wrong — the section tabs are a separate
          strip (the `tabs` prop, rendered above). */}
      <nav className={styles["bottom-tabs"]} aria-label="Primary">
        {nav
          .filter((item) => item.mobile !== false)
          .map((item) => (
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
        data-testid={item.testId}
      >
        <span className={styles["rail-icon"]}>{item.icon}</span>
        <span className={styles["rail-label"]}>{item.label}</span>
        {item.live === true ? (
          <span className={styles["rail-live"]}>
            <span className={styles["rail-live-dot"]} aria-hidden />
            Live
          </span>
        ) : item.badge !== undefined && item.badge > 0 ? (
          <span className={styles["rail-badge"]}>{item.badge}</span>
        ) : null}
      </Link>
    </li>
  );
}
