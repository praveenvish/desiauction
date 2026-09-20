"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import styles from "./tabs.module.css";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  /**
   * A short count or flag beside the label ("8", "2 left"). Read as part of
   * the tab's name, so keep it words a screen reader can say.
   */
  badge?: string | number;
  /** Draws the badge in the accent — something on this tab wants attention. */
  attention?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled selection; omit for uncontrolled with defaultTabId. */
  selectedId?: string;
  defaultTabId?: string;
  onSelect?: (id: string) => void;
  /** Accessible name for the tablist. */
  label: string;
}

/** WAI-ARIA tabs: roving tabindex, arrow/Home/End keys, automatic activation. */
export function Tabs({ tabs, selectedId, defaultTabId, onSelect, label }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState(defaultTabId ?? tabs[0]?.id ?? "");
  const active = selectedId ?? internal;

  const select = (id: string) => {
    setInternal(id);
    onSelect?.(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    let next: number | undefined;
    if (event.key === "ArrowRight") {
      next = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      next = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = tabs.length - 1;
    }
    if (next !== undefined) {
      event.preventDefault();
      const target = tabs[next];
      if (target !== undefined) {
        select(target.id);
        const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
        buttons?.[next]?.focus();
      }
    }
  };

  return (
    <div>
      {/*
        THE TABLIST IS NOT SUPPOSED TO BE FOCUSABLE.

        jsx-a11y wants a tabIndex on anything carrying an interactive role. The
        ARIA Authoring Practices say the opposite for this one: a tablist is a
        container, focus belongs to the tabs inside it, and exactly one of them
        is in the tab order at a time. Giving the list its own tab stop would add
        a dead stop before every tab strip in the product. The arrow-key handler
        lives here because the event bubbles from the focused tab, which is
        precisely the pattern the APG describes.
      */}
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className={styles["tablist"]}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            className={styles["tab"]}
            onClick={() => {
              select(tab.id);
            }}
          >
            {tab.label}
            {tab.badge !== undefined ? (
              <span
                className={styles["badge"]}
                data-attention={tab.attention === true ? "true" : undefined}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== active}
          tabIndex={0}
          className={styles["panel"]}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
