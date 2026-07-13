import { forwardRef, type HTMLAttributes } from "react";

import styles from "./card.module.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** doc 10 densities: default space-5, dense space-4, none for media edges. */
  padding?: "default" | "dense" | "none";
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = "default", className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={[styles["card"], styles[padding], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
});
