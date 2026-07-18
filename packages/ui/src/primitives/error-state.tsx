import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { IconAlert } from "../shell/icons";
import styles from "./error-state.module.css";

export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** Recovery actions — retry Button, home ButtonLink, support link. */
  actions?: ReactNode;
  headingLevel?: 1 | 2 | 3;
}

/** Designed error surface (PX-1 04 §8): apology, cause-free, with a way out. */
export const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(function ErrorState(
  { title, description, actions, headingLevel = 2, className, ...rest },
  ref,
) {
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";
  return (
    <div
      ref={ref}
      role="alert"
      className={[styles["error"], className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className={styles["icon"]}>
        <IconAlert width={28} height={28} />
      </span>
      <Heading className={styles["title"]}>{title}</Heading>
      {description !== undefined ? <p className={styles["description"]}>{description}</p> : null}
      {actions !== undefined ? <div className={styles["actions"]}>{actions}</div> : null}
    </div>
  );
});
