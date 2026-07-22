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
function WordmarkGlyph() {
  return (
    <span className={styles["wordmark-glyph"]} aria-hidden>
      <BrandGlyph />
    </span>
  );
}

/** The Public shell (S1): glass sticky header, content, columned footer. */
export function PublicShell({
  wordmark,
  wordmarkHref = "/",
  nav = [],
  headerAction,
  footerLinks = [],
  footerGroups = [],
  footerTagline,
  footerSocial,
  footerNewsletter,
  footerNote,
  footerBottomLinks = [],
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
            <WordmarkGlyph />
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
                        <IconChevronDown width={14} height={14} />
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
                  <Link key={link.href} href={link.href} className={styles["nav-link"]}>
                    {link.label}
                  </Link>
                ),
              )}
            </nav>
          ) : null}
          <div className={styles["header-action"]}>
            {headerAction}
            {nav.length > 0 ? <PublicMobileMenu nav={nav} linkComponent={Link} /> : null}
          </div>
        </div>
      </header>
      {/* Pages own their <main> landmark; this is the skip-link target. */}
      <div id="main-content" className={styles["content"]} tabIndex={-1}>
        {children}
      </div>
      <footer className={styles["footer"]} data-theme="floodlight">
        <div className={styles["footer-inner"]}>
          {footerGroups.length > 0 ? (
            <div className={styles["footer-grid"]}>
              <div className={styles["footer-brand"]}>
                <span className={styles["wordmark"]}>
                  <WordmarkGlyph />
                  {wordmark}
                </span>
                {footerTagline !== undefined ? (
                  <p className={styles["footer-tagline"]}>{footerTagline}</p>
                ) : null}
                {footerSocial !== undefined ? (
                  <div className={styles["footer-social"]} aria-hidden="true">
                    {footerSocial}
                  </div>
                ) : null}
              </div>
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
                {footerNewsletter !== undefined ? (
                  <div className={styles["footer-group"]}>
                    <h2 className={styles["footer-group-label"]}>Stay updated</h2>
                    {footerNewsletter}
                  </div>
                ) : null}
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
                <p className={styles["footer-note"]}>{footerNote}</p>
              ) : null}
              {footerBottomLinks.length > 0 ? (
                <nav aria-label="Legal" className={styles["footer-bottom-links"]}>
                  {footerBottomLinks.map((link) => (
                    <Link key={link.href} href={link.href} className={styles["footer-link"]}>
                      {link.label}
                    </Link>
                  ))}
                </nav>
              ) : null}
            </div>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
