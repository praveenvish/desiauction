/**
 * THE "NOT YET" PAGE — /blog, /case-studies, /api-docs, /careers.
 *
 * Honest placeholders: reachable (a link to one must not 404, and the census
 * visits them) but unadvertised — no nav, footer or search suggestion points
 * at them, and each is `noindex`. They used to be a full title band, then a
 * cream body holding one dashed, off-grid box, then the full footer: three
 * layers of apology. Now it is one centred composition inside the band itself.
 */
import { ButtonLink, IconClock } from "@desiauction/ui";
import type { ReactNode } from "react";

import "./public-kit.css";

export function ComingSoon({
  title,
  lede,
  note,
}: {
  /**
   * Kept for the callers, no longer drawn: the "Not published yet" badge and
   * a "JOIN US" eyebrow stacked two labels over one title (review r2, r3).
   */
  eyebrow?: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  /** One more line under the lede — a way to reach us about this. */
  note?: ReactNode;
}) {
  return (
    <main className="content-page">
      <header className="pk-hero pk-soon" data-theme="floodlight">
        <div className="pk-soon-inner">
          <span className="pk-soon-badge">
            <IconClock size={16} /> Not published yet
          </span>
          <h1 className="pk-hero-title">{title}</h1>
          <p className="pk-hero-lede">{lede}</p>
          {note === undefined ? null : <p className="pk-soon-note">{note}</p>}
          <div className="pk-hero-actions pk-soon-actions">
            <ButtonLink href="/" variant="primary">
              Back to home
            </ButtonLink>
            <ButtonLink href="/help" variant="secondary">
              Browse the help centre
            </ButtonLink>
          </div>
        </div>
      </header>
    </main>
  );
}
