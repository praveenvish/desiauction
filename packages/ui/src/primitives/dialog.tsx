"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { IconClose } from "../shell/icons";
import styles from "./dialog.module.css";

export interface DialogProps {
  open: boolean;
  /** Fired on Escape, backdrop click, or programmatic close. */
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Action row — usually Buttons; the last one should be the primary. */
  footer?: ReactNode;
  /** "wide" gives review flows (CSV import, previews) room; default is a form. */
  size?: "default" | "wide";
}

const FIELD =
  "[autofocus], input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([disabled]), textarea:not([disabled]), select:not([disabled])";

/**
 * WHERE THE CURSOR GOES WHEN A FORM OPENS: its first field.
 *
 * `showModal()` focuses the first focusable element, and in every dialog that
 * is the header's close button — so "Add a team", "New tournament" and the
 * rest opened with nothing to type into, and the first keystrokes went
 * nowhere. A dialog with no field (a confirmation) keeps the platform's
 * choice.
 */
function firstField(node: HTMLDialogElement): HTMLElement | null {
  for (const field of node.querySelectorAll<HTMLElement>(FIELD)) {
    // Layout-less environments have no checkVisibility; treat as visible.
    if (typeof field.checkVisibility !== "function" || field.checkVisibility()) {
      return field;
    }
  }
  return null;
}

/**
 * Built on native <dialog>: browser-managed focus trap, Escape, ::backdrop,
 * top-layer stacking — the simplest correct modal (IP-1_DESIGN §13 spirit).
 */
export function Dialog({ open, onClose, title, children, footer, size = "default" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    if (open && !node.open) {
      node.showModal();
      firstField(node)?.focus();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  return (
    /*
     * jsx-a11y reads `<dialog>` as a non-interactive element and asks for a
     * keyboard equivalent of the backdrop click below. There already is one and
     * it is the platform's: a modal `<dialog>` closes on Escape natively, which
     * fires `onClose` — the same handler the click ends up calling. Adding a key
     * listener here would be a second, worse implementation of Escape, on an
     * element a keyboard user cannot focus in the first place.
     */
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className={[styles["dialog"], size === "wide" ? styles["wide"] : ""]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop targets the dialog element itself — but so
        // does a click on the dialog's own padding or the gap beside a footer
        // button. Only treat it as a backdrop click when the point is actually
        // outside the dialog's box, so a near-miss on a button cannot dismiss
        // the form under the user's cursor.
        const node = ref.current;
        if (node === null || event.target !== node) {
          return;
        }
        const rect = node.getBoundingClientRect();
        const inside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        if (!inside) {
          onClose();
        }
      }}
    >
      <div className={styles["header"]}>
        <h2 className={styles["title"]} id={titleId}>
          {title}
        </h2>
        {/*
          Escape and a backdrop click were the only two exits, and neither
          survives a phone: the dialog is min(480px, 100vw - var(--space-8)),
          so at 390px the backdrop is a ~16px strip down each side — a target
          no thumb reliably finds — and Escape does not exist on touch at all.
          A visible affordance is the only exit a touch user can see.

          `title` is a required prop and every call site passes a real one, so
          interpolating it is safe. It also earns its keep: closed <dialog>s
          stay mounted in the DOM (FormDialog keeps its form there), so a bare
          "Close" would repeat across every dialog on the page and make the
          name ambiguous the moment a test or a screen reader enumerates them.
        */}
        <button
          type="button"
          className={styles["close"]}
          onClick={onClose}
          aria-label={`Close ${title}`}
        >
          <IconClose />
        </button>
      </div>
      <div className={styles["body"]}>{children}</div>
      {footer !== undefined ? <div className={styles["footer"]}>{footer}</div> : null}
    </dialog>
  );
}
