"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import styles from "./tabs.module.css";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
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
