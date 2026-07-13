import { forwardRef, type HTMLAttributes } from "react";

import styles from "./badge.module.css";

export type BadgeTone = "neutral" | "success" | "danger" | "warning" | "info" | "live";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "neutral", className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={[styles["badge"], styles[tone], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {tone === "live" ? <span className={styles["dot"]} aria-hidden /> : null}
      {children}
    </span>
  );
});
