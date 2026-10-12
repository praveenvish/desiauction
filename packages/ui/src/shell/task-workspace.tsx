import type { ReactNode } from "react";

import styles from "./task-workspace.module.css";

export interface TaskWorkspaceProps {
  /** Names the work region without adding another page heading. */
  label: string;
  className?: string;
  children: ReactNode;
  /** Recent history, evidence or readiness; never the only location of a required action. */
  supporting?: ReactNode;
  supportingLabel?: string;
}

/** Presentation only. Callers retain their existing readers, actions and authority. */
export function TaskWorkspace({
  label,
  className,
  children,
  supporting,
  supportingLabel = "Supporting information",
}: TaskWorkspaceProps) {
  return (
    <div
      className={[styles["workspace"], className].filter(Boolean).join(" ")}
      data-supporting={supporting !== undefined || undefined}
    >
      <section aria-label={label} className={styles["work"]}>
        {children}
      </section>
      {supporting !== undefined ? (
        <aside aria-label={supportingLabel} className={styles["supporting"]}>
          {supporting}
        </aside>
      ) : null}
    </div>
  );
}

export interface TaskStateProps {
  title: string;
  children?: ReactNode;
  /** Text is always required; colour never substitutes for state. */
  tone?: "neutral" | "attention" | "danger";
  /** Use for a changed local acknowledgement, not a second announcement of existing live state. */
  announce?: boolean;
  actions?: ReactNode;
}

/** A visible explanation; this component never decides that a write was accepted. */
export function TaskState({
  title,
  children,
  tone = "neutral",
  announce = false,
  actions,
}: TaskStateProps) {
  return (
    <div className={styles["state"]} data-tone={tone}>
      <div role={announce ? "status" : undefined} className={styles["message"]}>
        <strong>{title}</strong>
        {children !== undefined ? <div className={styles["detail"]}>{children}</div> : null}
      </div>
      {actions !== undefined ? <div className={styles["actions"]}>{actions}</div> : null}
    </div>
  );
}
