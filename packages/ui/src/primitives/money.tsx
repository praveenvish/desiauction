import { forwardRef, type HTMLAttributes } from "react";

import styles from "./money.module.css";

export type MoneyTone = "value" | "spent" | "remaining" | "frozen";

export interface MoneyProps extends HTMLAttributes<HTMLSpanElement> {
  /** Pre-formatted display string — ui never computes money (C-7 lives in core). */
  children: string;
  tone?: MoneyTone;
  /** Exact value (e.g. "₹1,10,50,000.00"), always inspectable per C-7. */
  exact?: string;
  /** Renders in the mono face for receipts/ledgers (doc 09). */
  mono?: boolean;
}

export const Money = forwardRef<HTMLSpanElement, MoneyProps>(function Money(
  { children, tone = "value", exact, mono = false, className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={[
        styles["money"],
        tone !== "value" ? styles[tone] : undefined,
        mono ? styles["exact"] : undefined,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...(exact !== undefined ? { title: exact, "aria-label": exact } : {})}
      {...rest}
    >
      {children}
    </span>
  );
});
