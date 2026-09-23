"use client";

import { buttonClassName, type ButtonSize, type ButtonVariant } from "@desiauction/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A client-side navigation styled as a console button. `buttonClassName` lives
 * in a "use client" module, so a server page cannot call it — it renders this
 * instead. Shared by /players, /auctions, /reports and /admin/notifications.
 */
export function NavButton({
  href,
  variant = "secondary",
  size = "touch",
  className,
  current = false,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Extra classes for layout; the button look stays the kit's. */
  className?: string;
  /** This link is the page being shown (a window switch, a tab): aria-current. */
  current?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={buttonClassName({ variant, size }, className)}
      {...(current ? { "aria-current": "page" as const } : {})}
    >
      {children}
    </Link>
  );
}
