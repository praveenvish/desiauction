"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import styles from "./dialog.module.css";

export interface DialogProps {
  open: boolean;
  /** Fired on Escape, backdrop click, or programmatic close. */
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Action row — usually Buttons; the last one should be the primary. */
  footer?: ReactNode;
}

/**
 * Built on native <dialog>: browser-managed focus trap, Escape, ::backdrop,
 * top-layer stacking — the simplest correct modal (IP-1_DESIGN §13 spirit).
 */
export function Dialog({ open, onClose, title, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    if (open && !node.open) {
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles["dialog"]}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop targets the dialog element itself.
        if (event.target === ref.current) {
          onClose();
        }
      }}
    >
      <div className={styles["header"]}>
        <h2 className={styles["title"]} id={titleId}>
          {title}
        </h2>
      </div>
      <div className={styles["body"]}>{children}</div>
      {footer !== undefined ? <div className={styles["footer"]}>{footer}</div> : null}
    </dialog>
  );
}
