"use client";

import { buttonClassName, type ButtonSize, type ButtonVariant } from "@desiauction/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A client-side navigation styled as a console button. `buttonClassName` lives
 * in a "use client" module, so a server page cannot call it — it renders this
 * instead. Shared by /players, /auctions and /reports.
 */
export function NavButton({
  href,
  variant = "secondary",
  size = "touch",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClassName({ variant, size })}>
      {children}
    </Link>
  );
}
