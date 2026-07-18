"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import styles from "./popover-menu.module.css";

export interface PopoverMenuItem {
  key: string;
  label: ReactNode;
  /** Navigation item — rendered as a link. */
  href?: string;
  /** Action item — rendered as a button (e.g. wraps a server action call). */
  onSelect?: () => void;
  danger?: boolean;
}

export interface PopoverMenuProps {
  /** Accessible name for the trigger (e.g. "Account menu"). */
  label: string;
  /** Trigger content (avatar initials, org name + chevron, …). */
  trigger: ReactNode;
  items: PopoverMenuItem[];
  /** Optional heading row inside the menu (e.g. the signed-in phone). */
  header?: ReactNode;
  align?: "start" | "end";
}

/**
 * Accessible popover menu (user menu, org switcher — PX-2 shell). Follows the
 * WAI-ARIA menu-button pattern: Enter/Space/ArrowDown open and focus the first
 * item, arrows cycle, Escape returns focus to the trigger, outside click closes.
 */
export function PopoverMenu({ label, trigger, items, header, align = "end" }: PopoverMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      focusItem(0);
    }
  }, [open]);

  const focusItem = (index: number) => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
    if (nodes === undefined || nodes.length === 0) {
      return;
    }
    const clamped = ((index % nodes.length) + nodes.length) % nodes.length;
    nodes[clamped]?.focus();
  };

  const currentIndex = (): number => {
    const nodes = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
    );
    return nodes.findIndex((node) => node === document.activeElement);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(currentIndex() + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(currentIndex() - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(-1);
    }
  };

  return (
    <div className={styles["root"]} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles["trigger"]}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={() => {
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open ? (
        <div className={[styles["menu"], styles[align]].join(" ")}>
          {header !== undefined ? <div className={styles["header"]}>{header}</div> : null}
          <ul
            id={menuId}
            role="menu"
            aria-label={label}
            className={styles["list"]}
            ref={listRef}
            onKeyDown={onMenuKeyDown}
          >
            {items.map((item) => (
              <li key={item.key} role="none">
                {item.href !== undefined ? (
                  <a
                    role="menuitem"
                    href={item.href}
                    className={[styles["item"], item.danger === true ? styles["danger"] : ""]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      setOpen(false);
                    }}
                  >
                    {item.label}
                  </a>
                ) : (
                  <button
                    role="menuitem"
                    type="button"
                    className={[styles["item"], item.danger === true ? styles["danger"] : ""]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      setOpen(false);
                      item.onSelect?.();
                    }}
                  >
                    {item.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
