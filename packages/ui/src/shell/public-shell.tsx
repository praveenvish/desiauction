import type { ElementType, ReactNode } from "react";

import styles from "./public-shell.module.css";

export interface PublicShellLink {
  label: string;
  href: string;
}

export interface PublicShellProps {
  wordmark: ReactNode;
  wordmarkHref?: string;
  /** Header links (only ones that exist — no dead links, PX-2 ruling). */
  nav?: PublicShellLink[];
  /** Right-side header slot: Sign in / user chip. */
  headerAction?: ReactNode;
  footerLinks?: PublicShellLink[];
  footerNote?: ReactNode;
  linkComponent?: ElementType;
  children: ReactNode;
}

/** The Public shell (S1): slim branded header, content, quiet footer. */
export function PublicShell({
  wordmark,
  wordmarkHref = "/",
  nav = [],
  headerAction,
  footerLinks = [],
  footerNote,
  linkComponent: Link = "a",
  children,
}: PublicShellProps) {
  return (
    <div className={styles["public"]}>
      <a className={styles["skip"]} href="#main-content">
        Skip to content
      </a>
      <header className={styles["header"]}>
        <Link href={wordmarkHref} className={styles["wordmark"]}>
          {wordmark}
        </Link>
        {nav.length > 0 ? (
          <nav aria-label="Site" className={styles["nav"]}>
            {nav.map((link) => (
              <Link key={link.href} href={link.href} className={styles["nav-link"]}>
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <div className={styles["header-action"]}>{headerAction}</div>
      </header>
      {/* Pages own their <main> landmark; this is the skip-link target. */}
      <div id="main-content" className={styles["content"]} tabIndex={-1}>
        {children}
      </div>
      <footer className={styles["footer"]}>
        {footerLinks.length > 0 ? (
          <nav aria-label="Footer" className={styles["footer-links"]}>
            {footerLinks.map((link) => (
              <Link key={link.href} href={link.href} className={styles["footer-link"]}>
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
        {footerNote !== undefined ? <p className={styles["footer-note"]}>{footerNote}</p> : null}
      </footer>
    </div>
  );
}
