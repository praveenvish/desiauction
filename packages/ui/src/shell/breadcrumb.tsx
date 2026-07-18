import type { ElementType } from "react";

import styles from "./breadcrumb.module.css";

export interface BreadcrumbItem {
  label: string;
  /** Omitted on the current (last) item. */
  href?: string;
}

export interface BreadcrumbProps {
  /** Max depth 3 by canon (docs/16); deeper input is an IA bug and is truncated. */
  items: BreadcrumbItem[];
  linkComponent?: ElementType;
}

export function Breadcrumb({ items, linkComponent: Link = "a" }: BreadcrumbProps) {
  const shown = items.slice(0, 3);
  return (
    <nav aria-label="Breadcrumb" className={styles["breadcrumb"]}>
      <ol className={styles["list"]}>
        {shown.map((item, index) => {
          const last = index === shown.length - 1;
          return (
            <li key={`${item.label}-${String(index)}`} className={styles["item"]}>
              {!last && item.href !== undefined ? (
                <Link href={item.href} className={styles["link"]}>
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={styles["current"]}>
                  {item.label}
                </span>
              )}
              {!last ? (
                <span aria-hidden className={styles["separator"]}>
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
