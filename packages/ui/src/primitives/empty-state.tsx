import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { IconInbox } from "../icons/icons";
import { IconTile, type KitConcept } from "./console-kit";
import styles from "./empty-state.module.css";

/**
 * THE EMPTY STATE (round 3B) — the one recipe for "nothing here yet", on every
 * surface: a duotone icon in a tinted tile, a one-line title, at most one line
 * of body, and at most a primary and a secondary action. There were three
 * (a gold tile, a grey ring, a bare one-line strip) plus a dozen page-local
 * ones; a person moving from the console to administration saw three products.
 *
 * `size="compact"` is the same recipe at card density — for a section inside a
 * card or a filtered table that came back empty — not a different design.
 */
export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: string;
  description?: ReactNode;
  /** The primary action — usually a Button or ButtonLink. */
  action?: ReactNode;
  /** A quieter second door (a ghost/secondary button or a link). */
  secondaryAction?: ReactNode;
  /** The glyph for the tile. Drawn duotone. Defaults to an empty tray. */
  icon?: ReactNode;
  /** The tile's colour, by concept (default: gold — the product's own). */
  concept?: KitConcept;
  /** Match the surrounding document outline (axe heading-order). */
  headingLevel?: 2 | 3 | 4;
  size?: "default" | "compact";
  testId?: string;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  {
    title,
    description,
    action,
    secondaryAction,
    icon,
    concept = "season",
    headingLevel = 3,
    size = "default",
    testId,
    className,
    ...rest
  },
  ref,
) {
  const Heading = headingLevel === 2 ? "h2" : headingLevel === 4 ? "h4" : "h3";
  return (
    <div
      ref={ref}
      className={[styles["empty"], className].filter(Boolean).join(" ")}
      data-size={size}
      data-testid={testId}
      {...rest}
    >
      <IconTile
        icon={icon ?? <IconInbox />}
        concept={concept}
        size={size === "compact" ? "md" : "lg"}
      />
      <Heading className={styles["title"]}>{title}</Heading>
      {description !== undefined && description !== null ? (
        <p className={styles["description"]}>{description}</p>
      ) : null}
      {action !== undefined || secondaryAction !== undefined ? (
        <div className={styles["action"]}>
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
});
