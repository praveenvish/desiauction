"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useTransition, type SyntheticEvent, type ReactNode } from "react";

/**
 * A GET filter form that applies itself (wow pass).
 *
 * The admin directories used to need a "Search"/"Filter" press after every
 * change. This keeps the form a plain `<form method="get">` — the param names,
 * the linkable URL and the no-script submit are all unchanged — and, with
 * script, navigates on its own: a select or date lands at once, typing lands
 * after a pause.
 *
 * The next URL is built from the FORM's own values (FormData), never from a
 * `useSearchParams` snapshot, and an empty value is simply absent — the rule
 * `use-filter-query.ts` explains. Paging (`after`) is not a field, so any
 * change starts from the first page, as a submitted form always did.
 *
 * The pages no longer key their Suspense on the query, so this form is NOT
 * remounted by its own navigation: the box keeps focus and the caret while the
 * results under it are replaced.
 */
const TYPING_DEBOUNCE_MS = 350;

export function AdminFilterForm({
  children,
  testId,
  className,
}: {
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const apply = () => {
    const form = formRef.current;
    if (form === null) return;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string" && value.trim() !== "") {
        params.append(key, value.trim());
      }
    }
    const query = params.toString();
    const next = query === "" ? pathname : `${pathname}?${query}`;
    startTransition(() => {
      router.replace(next, { scroll: false });
    });
  };

  const onChange = (event: SyntheticEvent<HTMLFormElement>) => {
    const target = event.target;
    const typing =
      target instanceof HTMLInputElement && (target.type === "search" || target.type === "text");
    if (!typing) {
      apply();
      return;
    }
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(apply, TYPING_DEBOUNCE_MS);
  };

  return (
    <form
      ref={formRef}
      method="get"
      role="search"
      className={["admin-toolbar-form", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      onChange={onChange}
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      {children}
    </form>
  );
}
