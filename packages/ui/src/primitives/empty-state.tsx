import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import styles from "./empty-state.module.css";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** Usually a Button or ButtonLink. */
  action?: ReactNode;
  /** Match the surrounding document outline (axe heading-order). */
  headingLevel?: 2 | 3;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { title, description, action, headingLevel = 3, className, ...rest },
  ref,
) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div ref={ref} className={[styles["empty"], className].filter(Boolean).join(" ")} {...rest}>
      <Heading className={styles["title"]}>{title}</Heading>
      {description !== undefined ? <p className={styles["description"]}>{description}</p> : null}
      {action !== undefined ? <div className={styles["action"]}>{action}</div> : null}
    </div>
  );
});
