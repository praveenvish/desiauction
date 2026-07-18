import type { ElementType, ReactNode } from "react";

import { IconArrowLeft } from "./icons";
import styles from "./live-shell.module.css";

export interface LiveShellProps {
  /** The one labeled door out (canon docs/16): never browser-back-dependent. */
  exitHref: string;
  exitLabel?: string;
  /** Persistent status strip slot (connection, seq, phase). */
  statusSlot?: ReactNode;
  linkComponent?: ElementType;
  children: ReactNode;
}

/** The Live shell (S3): full-screen, railless — the auction owns the viewport. */
export function LiveShell({
  exitHref,
  exitLabel = "Leave auction",
  statusSlot,
  linkComponent: Link = "a",
  children,
}: LiveShellProps) {
  return (
    <div className={styles["live"]}>
      <a className={styles["skip"]} href="#live-content">
        Skip to content
      </a>
      <header className={styles["strip"]}>
        <Link href={exitHref} className={styles["exit"]}>
          <IconArrowLeft width={16} height={16} />
          {exitLabel}
        </Link>
        {statusSlot !== undefined ? <div className={styles["status"]}>{statusSlot}</div> : null}
      </header>
      {/* Pages own their <main> landmark; this is the skip-link target. */}
      <div id="live-content" className={styles["content"]} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
