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
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Extra classes for layout; the button look stays the kit's. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClassName({ variant, size }, className)}>
      {children}
    </Link>
  );
}
