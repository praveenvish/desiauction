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
  /**
   * Where the mark leads. Optional: a conductor's cockpit wants no extra door,
   * but the public stage is the product's most-forwarded screen and its only
   * visitor arrives without an account — there, the mark is the way in.
   */
  brandHref?: string;
  linkComponent?: ElementType;
  children: ReactNode;
}

/** The Live shell (S3): full-screen, railless — the auction owns the viewport. */
export function LiveShell({
  exitHref,
  exitLabel = "Leave auction",
  statusSlot,
  brand,
  brandHref,
  linkComponent: Link = "a",
  children,
}: LiveShellProps) {
  const BrandBlock = brandHref === undefined ? "div" : Link;
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
          <BrandBlock
            className={[
              styles["live-brand"],
              brandHref === undefined ? undefined : styles["live-brand-link"],
            ]
              .filter(Boolean)
              .join(" ")}
            // The mark itself is decorative and the wordmark is hidden under
            // 640px, so a bare link would reach a phone with no name at all.
            {...(brandHref === undefined
              ? {}
              : { href: brandHref, "aria-label": "DesiAuction home" })}
          >
            <span className={styles["live-brand-mark"]} aria-hidden>
              {brand}
            </span>
            <span className={styles["live-brand-text"]}>DesiAuction</span>
          </BrandBlock>
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
