import type { ElementType, ReactNode } from "react";

import { IconChevronLeft, IconChevronRight } from "../icons/icons";
import styles from "./pager.module.css";

/**
 * THE PAGER (round 3B) — one on every list: "Showing 1–25 of 43" on the left,
 * ‹ 1 2 3 › on the right. There were six ("Next 50 →", "Page 1 of 3 ·
 * Previous / Next", "1 2 Next", arrows-only, a sentence and none at all).
 *
 * Two modes, one look:
 *  - NUMBERED, when the list knows its pages: pass `page`, `pageCount`,
 *    `total`, `pageSize`.
 *  - CURSOR, when it only knows "there is more" (keyset paging on admin):
 *    pass `total`, `shown`, `firstHref` (back to the start, when not on it)
 *    and `nextHref`.
 *
 * Each target is a link (`hrefFor` / `firstHref` / `nextHref`, server GET
 * pages — pass the router's Link as `linkComponent`) or a button (`onPage`,
 * client desks). No hooks, so it renders on the server or the client.
 */
export interface PagerProps {
  /** Accessible name of the <nav>. */
  label?: string;
  /** Total rows the list holds (after filters). */
  total: number;
  /** Numbered mode: the current page, 1-based. */
  page?: number;
  pageCount?: number;
  pageSize?: number;
  /** Rows on this page (cursor mode; numbered mode when the size is unknown). */
  shown?: number;
  hrefFor?: (page: number) => string;
  onPage?: (page: number) => void;
  firstHref?: string | null;
  nextHref?: string | null;
  linkComponent?: ElementType;
  /** A plural noun for the summary: "Showing 1–25 of 43 players" ("of 1 player"). */
  noun?: string;
  /** Anything else for the row (keyboard hints), drawn between the two ends. */
  children?: ReactNode;
  testId?: string;
  summaryTestId?: string;
  prevTestId?: string;
  nextTestId?: string;
}

const GROUPED = new Intl.NumberFormat("en-IN");

/** 1 … 4 5 6 … 12 — the first, the last and the current page's neighbours. */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((n) => wanted.has(n));
  const out: (number | null)[] = [];
  pages.forEach((n, i) => {
    const prev = pages[i - 1];
    if (prev !== undefined && n - prev > 1) out.push(n - prev === 2 ? n - 1 : null);
    out.push(n);
  });
  return out;
}

export function Pager({
  label = "Pages",
  total,
  page,
  pageCount,
  pageSize,
  shown,
  hrefFor,
  onPage,
  firstHref,
  nextHref,
  linkComponent: Link = "a",
  noun,
  children,
  testId,
  summaryTestId,
  prevTestId,
  nextTestId,
}: PagerProps) {
  const numbered = page !== undefined && pageCount !== undefined;
  // A plural noun; one of them reads singular ("of 1 player").
  const word = noun === undefined ? "" : ` ${total === 1 ? noun.replace(/s$/, "") : noun}`;
  const of = `${GROUPED.format(total)}${word}`;
  let summary: string;
  if (numbered && (pageSize !== undefined || shown !== undefined)) {
    // Without a page size, a full page's row count IS the size; the last page
    // counts back from the total.
    let first: number;
    if (pageSize !== undefined) first = (page - 1) * pageSize + 1;
    else if (page >= pageCount) first = total - (shown ?? 0) + 1;
    else first = (page - 1) * (shown ?? 0) + 1;
    if (total === 0) first = 0;
    const last =
      pageSize !== undefined ? Math.min(total, page * pageSize) : first + (shown ?? 0) - 1;
    summary = `Showing ${GROUPED.format(first)}–${GROUPED.format(last)} of ${of}`;
  } else {
    summary = `Showing ${GROUPED.format(shown ?? 0)} of ${of}`;
  }

  const target = (
    to: number | null,
    href: string | null | undefined,
    content: ReactNode,
    extra: { label?: string; current?: boolean; testId?: string | undefined; step?: boolean },
  ) => {
    const className = [styles["page"], extra.step === true ? styles["step"] : ""]
      .filter(Boolean)
      .join(" ");
    const common = {
      className,
      "aria-label": extra.label,
      "aria-current": extra.current === true ? ("page" as const) : undefined,
      "data-testid": extra.testId,
    };
    const disabled = to === null && (href === null || href === undefined);
    if (disabled) {
      // A disabled link: named, announced as unavailable (a bare span may not
      // carry an aria-label — axe aria-prohibited-attr).
      return (
        <span {...common} role="link" aria-disabled="true" data-disabled="">
          {content}
        </span>
      );
    }
    if (onPage !== undefined && to !== null) {
      return (
        <button
          type="button"
          {...common}
          onClick={() => {
            if (extra.current !== true) onPage(to);
          }}
        >
          {content}
        </button>
      );
    }
    const resolved = href ?? (to !== null && hrefFor !== undefined ? hrefFor(to) : undefined);
    if (resolved === undefined) {
      return (
        <span {...common} role="link" aria-disabled="true">
          {content}
        </span>
      );
    }
    return (
      <Link href={resolved} {...common}>
        {content}
      </Link>
    );
  };

  let controls: ReactNode = null;
  if (numbered) {
    if (pageCount > 1) {
      controls = (
        <span className={styles["controls"]}>
          {target(page > 1 ? page - 1 : null, null, <IconChevronLeft size={16} />, {
            label: "Previous page",
            testId: prevTestId,
            step: true,
          })}
          {pageWindow(page, pageCount).map((entry, index) =>
            entry === null ? (
              <span key={`gap-${String(index)}`} className={styles["gap"]} aria-hidden>
                …
              </span>
            ) : (
              <span key={entry} className={styles["slot"]}>
                {target(entry, null, GROUPED.format(entry), {
                  label: `Page ${String(entry)}`,
                  current: entry === page,
                })}
              </span>
            ),
          )}
          {target(page < pageCount ? page + 1 : null, null, <IconChevronRight size={16} />, {
            label: "Next page",
            testId: nextTestId,
            step: true,
          })}
        </span>
      );
    }
  } else if ((firstHref ?? null) !== null || (nextHref ?? null) !== null) {
    controls = (
      <span className={styles["controls"]}>
        {target(
          null,
          firstHref ?? null,
          <>
            <IconChevronLeft size={16} />
            First
          </>,
          { testId: prevTestId, step: true },
        )}
        {target(
          null,
          nextHref ?? null,
          <>
            Next
            <IconChevronRight size={16} />
          </>,
          { testId: nextTestId, step: true },
        )}
      </span>
    );
  }

  return (
    <nav className={styles["pager"]} aria-label={label} data-testid={testId}>
      <span className={styles["summary"]} data-testid={summaryTestId}>
        {summary}
      </span>
      {children !== undefined ? <span className={styles["extra"]}>{children}</span> : null}
      {controls}
    </nav>
  );
}
