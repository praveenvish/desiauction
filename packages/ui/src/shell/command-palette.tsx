"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { IconSearch } from "./icons";
import styles from "./command-palette.module.css";

/**
 * Command palette / search overlay (PX-2 shell §4). NAVIGATION-ONLY by scope
 * ruling: it filters targets the app already knows (routes, the user's orgs
 * and competitions) — there is no search backend. Selection calls onNavigate;
 * the app performs routing.
 */

export interface PaletteItem {
  key: string;
  label: string;
  /** Secondary line: org name, section, … */
  hint?: string;
  href: string;
  /** Extra match terms beyond the label. */
  keywords?: string;
}

export interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  groups: PaletteGroup[];
  onNavigate: (href: string) => void;
  placeholder?: string;
}

export function CommandPalette({
  open,
  onClose,
  groups,
  onNavigate,
  placeholder = "Where to? Type to filter…",
}: CommandPaletteProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    if (open && !node.open) {
      node.showModal();
      setQuery("");
      setCursor(0);
      // Native dialog focuses the first focusable; make it explicit.
      inputRef.current?.focus();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  const flat = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (item: PaletteItem) =>
      needle === "" ||
      item.label.toLowerCase().includes(needle) ||
      (item.hint ?? "").toLowerCase().includes(needle) ||
      (item.keywords ?? "").toLowerCase().includes(needle);
    return groups
      .map((group) => ({ ...group, items: group.items.filter(matches) }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const ordered = useMemo(() => flat.flatMap((group) => group.items), [flat]);
  const activeItem = ordered[Math.min(cursor, Math.max(ordered.length - 1, 0))];

  const go = (href: string) => {
    onClose();
    onNavigate(href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, ordered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter" && activeItem !== undefined) {
      event.preventDefault();
      go(activeItem.href);
    }
  };

  return (
    <dialog
      ref={ref}
      className={styles["palette"]}
      aria-label="Go to"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) {
          onClose();
        }
      }}
    >
      <div className={styles["input-row"]}>
        <IconSearch />
        <input
          ref={inputRef}
          className={styles["input"]}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={
            activeItem !== undefined ? `${listId}-${activeItem.key}` : undefined
          }
          aria-autocomplete="list"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className={styles["kbd"]}>esc</kbd>
      </div>
      <div className={styles["results"]} id={listId} role="listbox" aria-label="Destinations">
        {flat.length === 0 ? (
          <p className={styles["empty"]}>Nothing matches — try a shorter word.</p>
        ) : (
          flat.map((group) => (
            <div key={group.label} className={styles["group"]}>
              <span className={styles["group-label"]}>{group.label}</span>
              <ul className={styles["list"]}>
                {group.items.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      id={`${listId}-${item.key}`}
                      role="option"
                      aria-selected={activeItem?.key === item.key}
                      className={[
                        styles["item"],
                        activeItem?.key === item.key ? styles["item-active"] : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        go(item.href);
                      }}
                      onMouseMove={() => {
                        const index = ordered.findIndex((entry) => entry.key === item.key);
                        if (index >= 0) {
                          setCursor(index);
                        }
                      }}
                    >
                      <span className={styles["item-label"]}>{item.label}</span>
                      {item.hint !== undefined ? (
                        <span className={styles["item-hint"]}>{item.hint}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </dialog>
  );
}
