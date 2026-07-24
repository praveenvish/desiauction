import type { ElementType, ReactNode } from "react";

import { IconArrowLeft } from "./icons";
import styles from "./live-shell.module.css";

export interface LiveShellProps {
  /** The one labeled door out (canon docs/16): never browser-back-dependent. */
  exitHref: string;
  exitLabel?: string;
  /** Persistent status strip slot (connection, seq, phase). */
  statusSlot?: ReactNode;
  /**
   * The brand mark. Live surfaces are the ones most likely to be projected,
   * screenshotted and streamed, and they were the only shells carrying no
   * identity at all. Injected like AppShell's glyph so this package keeps
   * shipping no asset of its own.
   */
  brand?: ReactNode;
  linkComponent?: ElementType;
  children: ReactNode;
}

/** The Live shell (S3): full-screen, railless — the auction owns the viewport. */
export function LiveShell({
  exitHref,
  exitLabel = "Leave auction",
  statusSlot,
  brand,
  linkComponent: Link = "a",
  children,
}: LiveShellProps) {
  return (
    // Canon 04 §3: the Live shell is pinned to Floodlight — the show is always
    // dark, projector-honest. This scopes the dark token set to everything the
    // auction renders (cockpit, live, spectate, replay).
    <div className={styles["live"]} data-theme="floodlight">
      <a className={styles["skip"]} href="#live-content">
        Skip to content
      </a>
      <header className={styles["strip"]}>
        <Link href={exitHref} className={styles["exit"]}>
          <IconArrowLeft width={16} height={16} />
          {exitLabel}
        </Link>
        {brand !== undefined ? (
          <div className={styles["live-brand"]}>
            <span className={styles["live-brand-mark"]} aria-hidden>
              {brand}
            </span>
            <span className={styles["live-brand-text"]}>DesiAuction</span>
          </div>
        ) : null}
        {statusSlot !== undefined ? <div className={styles["status"]}>{statusSlot}</div> : null}
      </header>
      {/* Pages own their <main> landmark; this is the skip-link target. */}
      <div id="live-content" className={styles["content"]} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
