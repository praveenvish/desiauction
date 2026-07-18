"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { IconClose } from "./icons";
import styles from "./drawer.module.css";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "start" | "end";
  children: ReactNode;
}

/**
 * Side sheet on native <dialog> (same correctness base as Dialog: browser
 * focus trap, Escape, top layer). Used by the shell for mobile navigation
 * overflow; generic for future side panels.
 */
export function Drawer({ open, onClose, title, side = "end", children }: DrawerProps) {
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
      className={[styles["drawer"], styles[side]].join(" ")}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) {
          onClose();
        }
      }}
    >
      <div className={styles["header"]}>
        <h2 className={styles["title"]} id={titleId}>
          {title}
        </h2>
        <button type="button" className={styles["close"]} aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className={styles["body"]}>{children}</div>
    </dialog>
  );
}
