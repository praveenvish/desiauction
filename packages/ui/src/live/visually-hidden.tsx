import type { HTMLAttributes } from "react";

import styles from "./visually-hidden.module.css";

/** Screen-reader-only content — the standard clip pattern (C-15). */
export function VisuallyHidden({ children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={styles["hidden"]} {...rest}>
      {children}
    </span>
  );
}
