import { Fragment, type ReactNode } from "react";

import { BrandGlyph, IconChevronDown } from "./icons";
import { PopoverMenu } from "./popover-menu";
import { PublicMobileMenu } from "./public-mobile-menu";
import styles from "./public-shell.module.css";
import type { PublicShellProps } from "./public-shell-types";

// The shell's public prop types live in `./public-shell-types` so the mobile
// menu can share them without importing this module back (no-circular gate).
// Re-exported here to keep `@desiauction/ui`'s surface unchanged.
export type {
  PublicShellFooterGroup,
  PublicShellLink,
  PublicShellProps,
} from "./public-shell-types";

/** The brand glyph in its chip. Decorative — the shared BrandGlyph is also used
    by the console AppShell so the two headers can never drift. */
function WordmarkGlyph({ glyph }: { glyph: ReactNode }) {
  return (
    <span className={styles["wordmark-glyph"]} aria-hidden>
      {glyph}
    </span>
  );
}

/** The Public shell (S1): glass sticky header, content, columned footer. */
export function PublicShell({
  wordmark,
  wordmarkHref = "/",
  glyph = <BrandGlyph />,
  nav = [],
  headerAction,
  mobileAction,
  mobileSearchHref,
  footerLinks = [],
  footerGroups = [],
  footerWordmark,
  footerTagline,
  footerHeading,
  footerSocial,
  footerNewsletter,
  footerNote,
  footerLegal,
  footerBottomLinks = [],
  footerCompact = false,
  contentFill = false,
  linkComponent: Link = "a",
  children,
}: PublicShellProps) {
  return (
    <div className={styles["public"]}>
      <a className={styles["skip"]} href="#main-content">
        Skip to content
      </a>
      <header className={styles["header"]} data-theme="floodlight">
        <div className={styles["header-inner"]}>
          <Link href={wordmarkHref} className={styles["wordmark"]}>
            <WordmarkGlyph glyph={glyph} />
            {wordmark}
          </Link>
          {nav.length > 0 ? (
            <nav aria-label="Site" className={styles["nav"]}>
              {nav.map((link) =>
                link.children !== undefined && link.children.length > 0 ? (
                  <PopoverMenu
                    key={link.label}
                    label={link.label}
                    trigger={
                      <>
                        {link.label}
                        <IconChevronDown size={16} />
                      </>
                    }
                    triggerClassName={styles["nav-link"] ?? ""}
                    items={link.children.map((child) => ({
                      key: child.href,
                      label: child.label,
                      href: child.href,
                    }))}
                  />
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={styles["nav-link"]}
                    // The header's only statement of where you are. Without it
                    // a screen-reader user tabbing the nav on /c hears five
                    // destinations and no indication that one of them is the
                    // page already open.
                    aria-current={link.active === true ? "page" : undefined}
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </nav>
          ) : null}
          <div className={styles["header-action"]}>
            {headerAction}
            {nav.length > 0 ? (
              <PublicMobileMenu
                nav={nav}
                linkComponent={Link}
                {...(mobileAction !== undefined ? { action: mobileAction } : {})}
                {...(mobileSearchHref !== undefined ? { searchHref: mobileSearchHref } : {})}
              />
            ) : null}
          </div>
        </div>
      </header>
      {/* Pages own their <main> landmark; this is the skip-link target. */}
      <div
        id="main-content"
        className={styles["content"]}
        data-fill={contentFill ? "" : undefined}
        tabIndex={-1}
      >
        {children}
      </div>
      <footer
        className={styles["footer"]}
        data-theme="floodlight"
        data-compact={footerCompact ? "" : undefined}
      >
        <div className={styles["footer-inner"]}>
          {footerCompact ? null : footerGroups.length > 0 ? (
            // One DOM for every width: brand, subscribe, links. A laptop lays
            // the subscribe row out as its own band under the other two; a
            // tablet puts it beside the brand; a phone stacks all three.
            <div className={styles["footer-grid"]}>
              <div className={styles["footer-brand"]}>
                <Link href={wordmarkHref} className={styles["wordmark"]}>
                  <WordmarkGlyph glyph={glyph} />
                  {footerWordmark ?? wordmark}
                </Link>
                {footerHeading !== undefined ? (
                  <p className={styles["footer-heading"]}>{footerHeading}</p>
                ) : null}
                {footerTagline !== undefined ? (
                  <p className={styles["footer-tagline"]}>{footerTagline}</p>
                ) : null}
                {footerSocial !== undefined ? (
                  <div className={styles["footer-social"]}>{footerSocial}</div>
                ) : null}
              </div>
              {footerNewsletter !== undefined ? (
                <div className={styles["footer-newsletter"]}>{footerNewsletter}</div>
              ) : null}
              <nav aria-label="Footer" className={styles["footer-columns"]}>
                {footerGroups.map((group) => (
                  <div key={group.label} className={styles["footer-group"]}>
                    <h2 className={styles["footer-group-label"]}>{group.label}</h2>
                    <ul className={styles["footer-group-list"]}>
                      {group.links.map((link) => (
                        <li key={link.href}>
                          <Link href={link.href} className={styles["footer-link"]}>
                            {link.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
            </div>
          ) : footerLinks.length > 0 ? (
            <nav aria-label="Footer" className={styles["footer-links"]}>
              {footerLinks.map((link) => (
                <Link key={link.href} href={link.href} className={styles["footer-link"]}>
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : null}
          {footerNote !== undefined || footerBottomLinks.length > 0 ? (
            <div className={styles["footer-bottom"]}>
              {footerNote !== undefined ? (
                <p className={styles["footer-note"]}>
                  {Array.isArray(footerNote)
                    ? (footerNote as readonly string[]).map((line, index) => (
                        <span key={line} className={styles["footer-note-line"]}>
                          {index > 0 ? (
                            <span className={styles["footer-note-sep"]} aria-hidden>
                              {" · "}
                            </span>
                          ) : null}
                          {line}
                        </span>
                      ))
                    : footerNote}
                </p>
              ) : null}
              {footerBottomLinks.length > 0 ? (
                <nav aria-label="Legal" className={styles["footer-bottom-links"]}>
                  {footerBottomLinks.map((link, index) => (
                    <Fragment key={link.href}>
                      {/* A phone sets the links as two balanced lines (3 + 2)
                          so the longest never wraps onto a line of its own. */}
                      {index === Math.ceil(footerBottomLinks.length / 2) ? (
                        <span className={styles["footer-bottom-break"]} aria-hidden />
                      ) : null}
                      <Link
                        href={link.href}
                        className={styles["footer-link"]}
                        aria-haspopup={link.popup}
                      >
                        {link.label}
                      </Link>
                    </Fragment>
                  ))}
                </nav>
              ) : null}
            </div>
          ) : null}
          {/* Optional fine print under the bottom bar. The app no longer passes
              the operator identity here — it is published on /legal, /support
              and /legal/grievances instead — but the slot stays for any
              surface that needs a line of small print. */}
          {footerCompact || footerLegal === undefined ? null : (
            <div className={styles["footer-legal"]}>{footerLegal}</div>
          )}
        </div>
      </footer>
    </div>
  );
}
