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
  /**
   * Trail mode: the items are the current page's ANCESTORS, not the page
   * itself — used by the console header, where the page is the `<h1>` sitting
   * directly beneath. Nothing claims `aria-current`, and the last item stays a
   * link, because in this mode it is somewhere you can still go.
   */
  trail?: boolean;
}

export function Breadcrumb({ items, linkComponent: Link = "a", trail = false }: BreadcrumbProps) {
  const shown = items.slice(0, 3);
  return (
    <nav
      aria-label="Breadcrumb"
      className={[styles["breadcrumb"], trail ? styles["as-trail"] : ""].filter(Boolean).join(" ")}
    >
      <ol className={styles["list"]}>
        {shown.map((item, index) => {
          const last = index === shown.length - 1;
          const asText = item.href === undefined || (last && !trail);
          return (
            <li key={`${item.label}-${String(index)}`} className={styles["item"]}>
              {asText ? (
                <span
                  aria-current={last && !trail ? "page" : undefined}
                  className={styles["current"]}
                >
                  {item.label}
                </span>
              ) : (
                <Link href={item.href as string} className={styles["link"]}>
                  {item.label}
                </Link>
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
