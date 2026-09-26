"use client";

import {
  useEffect,
  useRef,
  type AnchorHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { IconChevronDown, IconClose, IconFilter, IconSearch } from "../icons/icons";
import { useLinkComponent } from "./link-context";
import { useActiveInView } from "./use-active-in-view";
import styles from "./toolbar.module.css";

/*
 * THE ONE-ROW TOOLBAR (2026-09-25).
 *
 * Every list page used to stack its controls: a count row, a header row, a
 * search row, a row of five labelled selects that wrapped to two, a select-all
 * row. The data started 500–700px down. This kit puts them on ONE row:
 *
 *   [ 🔍 Search…  / ] [Role: Batter ✕] [Fee: Unpaid ✕] Clear ·· 24 of 110 [Filters · 2] [Sort ▾]
 *
 * Primary filters that people flip constantly become <SegmentedTabs> above or
 * beside it; the rest live in <FilterMenu>, and whatever is set shows as a
 * removable <ToolbarChip>, so the state of the list is always visible without
 * spending a row on selects nobody is touching. It wraps gracefully on a phone.
 *
 * The kit only arranges controls; the page still owns its <form>, its query
 * string (useFilterQuery) and its submit — server-rendered GET forms work,
 * because <FilterMenu> is a <details> and needs no script to open.
 */

export function Toolbar({
  children,
  testId,
  className,
}: {
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={[styles["toolbar"], className].filter(Boolean).join(" ")} data-testid={testId}>
      {children}
    </div>
  );
}

/** Pushes everything after it to the row's end. */
export function ToolbarSpacer() {
  return <span className={styles["spacer"]} aria-hidden />;
}

/** "24 of 110" — quiet, tabular, never a heading. */
export function ToolbarCount({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <span className={styles["count"]} data-testid={testId}>
      {children}
    </span>
  );
}

export interface ToolbarSearchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "size"
> {
  id: string;
  /** Accessible name. Rendered visually hidden: the icon and placeholder carry it. */
  label: string;
  /** A keyboard hint drawn inside the field ("/"). Purely visual. */
  shortcut?: string;
  /** Make the magnifier a submit button (server GET forms). */
  submitLabel?: string;
  testId?: string;
}

export function ToolbarSearch({
  id,
  label,
  shortcut,
  submitLabel,
  testId,
  className,
  ...input
}: ToolbarSearchProps) {
  return (
    <div className={[styles["search"], className].filter(Boolean).join(" ")}>
      {submitLabel !== undefined ? (
        <button type="submit" className={styles["searchIcon"]} aria-label={submitLabel}>
          <IconSearch size={16} />
        </button>
      ) : (
        <span className={styles["searchIcon"]} aria-hidden>
          <IconSearch size={16} />
        </span>
      )}
      <label htmlFor={id} className={styles["srOnly"]}>
        {label}
      </label>
      <input
        id={id}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        className={styles["searchInput"]}
        data-testid={testId}
        {...input}
      />
      {shortcut !== undefined ? (
        <kbd className={styles["kbd"]} aria-hidden>
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
}

/**
 * One active filter, removable. A button when the page filters client-side
 * (`onRemove`), a link when it filters by URL (`href` = the URL without it).
 */
export function ToolbarChip({
  children,
  onRemove,
  href,
  removeLabel,
  testId,
}: {
  children: ReactNode;
  onRemove?: () => void;
  href?: string;
  /** Accessible name of the ✕, e.g. "Remove role filter". */
  removeLabel: string;
  testId?: string;
}) {
  const LinkComponent = useLinkComponent();
  return (
    <span className={styles["chip"]} data-testid={testId}>
      <span className={styles["chipLabel"]}>{children}</span>
      {href !== undefined ? (
        // eslint-disable-next-line react-hooks/static-components -- the context holds one module-level component (next/link), set once at the root; nothing is created per render.
        <LinkComponent href={href} className={styles["chipRemove"]} aria-label={removeLabel}>
          <IconClose size={14} />
        </LinkComponent>
      ) : (
        <button
          type="button"
          className={styles["chipRemove"]}
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <IconClose size={14} />
        </button>
      )}
    </span>
  );
}

/**
 * The secondary filters, behind one button with a count of what is set.
 * A <details>, so it opens without script (server GET forms keep working);
 * with script it also closes on Escape and on a click outside.
 */
export function FilterMenu({
  children,
  activeCount = 0,
  label = "Filters",
  align = "end",
  testId,
  footer,
}: {
  children: ReactNode;
  activeCount?: number;
  label?: string;
  align?: "start" | "end";
  testId?: string;
  /** Pinned under the fields: "24 players match", an Apply button. */
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (details === null) return;
    const onPointer = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) details.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.open) {
        details.open = false;
        details.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <details ref={ref} className={styles["menu"]} data-testid={testId}>
      <summary className={styles["menuButton"]} data-active={activeCount > 0 || undefined}>
        <IconFilter size={16} />
        <span>{label}</span>
        {activeCount > 0 ? (
          <span className={styles["menuBadge"]}>
            {activeCount}
            <span className={styles["srOnly"]}> active</span>
          </span>
        ) : null}
        <IconChevronDown size={16} className={styles["menuCaret"]} />
      </summary>
      <div className={styles["panel"]} data-align={align}>
        <div className={styles["panelBody"]}>{children}</div>
        {footer !== undefined ? <div className={styles["panelFoot"]}>{footer}</div> : null}
      </div>
    </details>
  );
}

export interface SegmentedItem {
  key: string;
  label: ReactNode;
  count?: ReactNode;
  active?: boolean;
  /** A gold dot: "something here needs you". */
  attention?: boolean;
  href?: string;
  onSelect?: () => void;
  testId?: string;
}

/**
 * Status tabs with counts — "All 110 · To review 12 · Approved 86". They
 * replace the grid of count cards that sat above list pages: the same numbers,
 * one row, and each one is the filter it describes.
 */
export function SegmentedTabs({
  items,
  label,
  testId,
}: {
  items: SegmentedItem[];
  /** Accessible name of the group, e.g. "Registration status". */
  label: string;
  testId?: string;
}) {
  const LinkComponent = useLinkComponent();
  const ref = useRef<HTMLElement>(null);
  useActiveInView(ref, items.find((item) => item.active === true)?.key);
  return (
    <nav ref={ref} className={styles["segmented"]} aria-label={label} data-testid={testId}>
      {items.map((item) => {
        const inner = (
          <>
            <span>{item.label}</span>
            {item.count !== undefined ? (
              <span className={styles["segCount"]}>{item.count}</span>
            ) : null}
            {item.attention === true ? <span className={styles["segDot"]} aria-hidden /> : null}
          </>
        );
        const common = {
          className: styles["seg"],
          "data-active": item.active === true || undefined,
          "aria-current": item.active === true ? ("page" as const) : undefined,
          "data-testid": item.testId,
        };
        return item.href !== undefined ? (
          <LinkComponent
            key={item.key}
            href={item.href}
            {...(common as AnchorHTMLAttributes<HTMLAnchorElement>)}
          >
            {inner}
          </LinkComponent>
        ) : (
          <button
            key={item.key}
            type="button"
            onClick={item.onSelect}
            {...common}
            aria-pressed={item.active === true}
            aria-current={undefined}
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}

export interface ToolbarSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  id: string;
  /** Accessible name; drawn as a quiet prefix ("Sort") unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  options: readonly { value: string; label: string }[];
  testId?: string;
}

/**
 * A native select dressed as a toolbar control — "Sort: Newest ▾". Native on
 * purpose: it works in a server GET form, on a phone it opens the OS picker,
 * and e2e can `selectOption` it. Same 36px rung as the search and the menu.
 */
export function ToolbarSelect({
  id,
  label,
  hideLabel = false,
  options,
  testId,
  className,
  ...select
}: ToolbarSelectProps) {
  return (
    <span className={[styles["select"], className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={hideLabel ? styles["srOnly"] : styles["selectLabel"]}>
        {label}
      </label>
      <select id={id} className={styles["selectInput"]} data-testid={testId} {...select}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <IconChevronDown size={16} className={styles["selectCaret"]} />
    </span>
  );
}

export interface ToolbarToggleItem {
  key: string;
  /** Accessible name (visually hidden when an icon is given). */
  label: string;
  icon?: ReactNode;
  active: boolean;
  onSelect: () => void;
  testId?: string;
}

/**
 * Two or three states of one setting — List / Grid — as a pressed-button
 * group, so a screen reader announces which is current.
 */
export function ToolbarToggle({
  items,
  label,
  testId,
}: {
  items: ToolbarToggleItem[];
  label: string;
  testId?: string;
}) {
  return (
    <div className={styles["toggle"]} role="group" aria-label={label} data-testid={testId}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={styles["toggleBtn"]}
          aria-pressed={item.active}
          onClick={item.onSelect}
          data-testid={item.testId}
          data-icon={item.icon !== undefined || undefined}
        >
          {item.icon !== undefined ? (
            <>
              {item.icon}
              <span className={styles["srOnly"]}>{item.label}</span>
            </>
          ) : (
            item.label
          )}
        </button>
      ))}
    </div>
  );
}
