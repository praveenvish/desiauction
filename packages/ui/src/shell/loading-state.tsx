import { Skeleton } from "../primitives/skeleton";
import styles from "./loading-state.module.css";

export interface LoadingStateProps {
  /** Shape-accurate presets (PX-1 04 §8): page header, table rows, card grid. */
  variant?: "page" | "table" | "cards";
  /** Row/card count for table/cards variants. */
  count?: number;
}

/**
 * Route-level loading composition. Decorative (Skeletons are aria-hidden);
 * a visually-hidden status line announces loading once for assistive tech.
 */
export function LoadingState({ variant = "page", count = 5 }: LoadingStateProps) {
  return (
    <div className={styles["loading"]}>
      <span className={styles["sr-status"]} role="status">
        Loading
      </span>
      {variant === "page" ? (
        <>
          <Skeleton width="40%" height="32px" />
          <Skeleton width="24%" height="16px" />
          <div className={styles["block"]}>
            <Skeleton height="120px" />
          </div>
          <div className={styles["block"]}>
            <Skeleton height="120px" />
          </div>
        </>
      ) : null}
      {variant === "table" ? (
        <>
          <Skeleton width="32%" height="28px" />
          <div className={styles["rows"]}>
            {Array.from({ length: count }, (_, index) => (
              <Skeleton key={index} height="40px" />
            ))}
          </div>
        </>
      ) : null}
      {variant === "cards" ? (
        <div className={styles["grid"]}>
          {Array.from({ length: count }, (_, index) => (
            <Skeleton key={index} height="96px" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
