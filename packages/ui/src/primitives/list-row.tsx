import type { ElementType, ReactNode } from "react";

/**
 * THE LIST ROW (round 3B) — one compact row for every list on a phone (and
 * the lists that stay lists on a laptop): lead · title over a one-line meta ·
 * a right-aligned figure over a status. Title and meta ellipsize, so a price
 * never steals the name's width and nothing wraps to a third line.
 *
 * Styles are global (system.css, `.da-row*`) because tables use the same
 * recipe through `table.da-rows` + `data-cell` — see the note there.
 */
export interface ListRowProps {
  title: ReactNode;
  meta?: ReactNode;
  /** An avatar, monogram or icon tile. */
  lead?: ReactNode;
  /** The right-aligned figure: an amount, a count, a time. */
  figure?: ReactNode;
  /** A pill or a dot + word, under the figure. */
  status?: ReactNode;
  /** Makes the whole row a link. */
  href?: string;
  linkComponent?: ElementType;
  as?: ElementType;
  className?: string;
  testId?: string;
}

export function ListRow({
  title,
  meta,
  lead,
  figure,
  status,
  href,
  linkComponent: Link = "a",
  as,
  className,
  testId,
}: ListRowProps) {
  const Tag: ElementType = href !== undefined ? Link : (as ?? "div");
  return (
    <Tag
      {...(href !== undefined ? { href } : {})}
      className={["da-row", className].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      {lead !== undefined ? <span className="da-row-lead">{lead}</span> : null}
      <span className="da-row-title">{title}</span>
      {meta !== undefined ? <span className="da-row-meta">{meta}</span> : null}
      {figure !== undefined ? <span className="da-row-figure">{figure}</span> : null}
      {status !== undefined ? <span className="da-row-status">{status}</span> : null}
    </Tag>
  );
}

/** A status as a coloured dot and a word in primary ink (never colour alone). */
export function StateDot({ state }: { state: string | null }) {
  return <span className="da-dot" data-state={state ?? undefined} aria-hidden />;
}
