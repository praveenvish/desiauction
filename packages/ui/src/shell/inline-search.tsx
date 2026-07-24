"use client";

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { IconSearch } from "./icons";
import { filterGroups, type PaletteGroup } from "./search-filter";
import styles from "./inline-search.module.css";

/**
 * Top-bar search (console). At rest it is one icon in the utility cluster; on
 * activation the field grows LEFTWARD out of that icon — the icon never moves,
 * so the row's right edge stays put and nothing else in the bar reflows. The
 * results hang directly under the field, right-aligned to it.
 *
 * NAVIGATION-ONLY, like the palette it replaces: it filters destinations the
 * app already knows (routes, the viewer's orgs and seasons). There is no search
 * backend, so there is nothing to debounce.
 */

export interface InlineSearchHandle {
  /** Open and focus the field (⌘K). */
  open: () => void;
  /** Open if closed, close if open. */
  toggle: () => void;
}

export interface InlineSearchProps {
  groups: PaletteGroup[];
  onNavigate: (href: string) => void;
  /** Imperative handle for the shell's ⌘K binding. */
  handleRef?: RefObject<InlineSearchHandle | null>;
  placeholder?: string;
  /** Accessible name for the collapsed trigger. */
  label?: string;
}

export function InlineSearch({
  groups,
  onNavigate,
  handleRef,
  placeholder = "Search seasons, teams, players…",
  label = "Search (⌘K)",
}: InlineSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // The trigger does not exist while the field is open, so "give focus back"
  // is an intent recorded now and honoured once the collapsed button remounts.
  const returnFocus = useRef(false);
  const close = useCallback((focusTrigger: boolean) => {
    returnFocus.current = focusTrigger;
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      open: () => {
        setOpen(true);
      },
      toggle: () => {
        setOpen((value) => {
          if (value) {
            setQuery("");
            setCursor(0);
          }
          return !value;
        });
      },
    }),
    [],
  );

  // Neither control outlives the other, so focus has to follow the mount.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  // Outside pointer or focus leaving the widget closes it — without stealing
  // focus back, which would fight the click that caused it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: Event) => {
      const root = rootRef.current;
      if (root !== null && !root.contains(event.target as Node)) {
        close(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, close]);

  const results = useMemo(() => filterGroups(groups, query), [groups, query]);
  const ordered = useMemo(() => results.flatMap((group) => group.items), [results]);
  const activeItem = ordered[Math.min(cursor, Math.max(ordered.length - 1, 0))];

  const go = (href: string) => {
    close(false);
    onNavigate(href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
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
    <div className={styles["root"]} ref={rootRef} data-open={open}>
      {open ? (
        <div className={styles["field"]}>
          <span className={styles["field-icon"]} aria-hidden>
            <IconSearch />
          </span>
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
            aria-label={placeholder}
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
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className={styles["trigger"]}
          aria-label={label}
          aria-expanded={false}
          title="Search"
          data-testid="shell-search"
          onClick={() => {
            setOpen(true);
          }}
        >
          <IconSearch />
        </button>
      )}
      {open ? (
        <div className={styles["results"]}>
          <div id={listId} role="listbox" aria-label="Destinations" className={styles["scroll"]}>
            {results.length === 0 ? (
              <p className={styles["empty"]}>Nothing matches — try a shorter word.</p>
            ) : (
              results.map((group) => (
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
        </div>
      ) : null}
    </div>
  );
}
