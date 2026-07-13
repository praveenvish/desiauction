import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import styles from "./empty-state.module.css";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** Usually a Button or ButtonLink. */
  action?: ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { title, description, action, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={[styles["empty"], className].filter(Boolean).join(" ")} {...rest}>
      <h3 className={styles["title"]}>{title}</h3>
      {description !== undefined ? <p className={styles["description"]}>{description}</p> : null}
      {action !== undefined ? <div className={styles["action"]}>{action}</div> : null}
    </div>
  );
});
