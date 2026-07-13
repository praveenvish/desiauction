import { forwardRef, type HTMLAttributes } from "react";

import styles from "./skeleton.module.css";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string;
  height?: string;
}

/** Loading placeholder — decorative, hidden from assistive tech. */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { width = "100%", height = "16px", className, style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-hidden
      className={[styles["skeleton"], className].filter(Boolean).join(" ")}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
});
