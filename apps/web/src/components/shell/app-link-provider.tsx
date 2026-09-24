"use client";

import { LinkComponentProvider } from "@desiauction/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Hands `next/link` to the UI package's link-rendering primitives (ButtonLink,
 * PopoverMenu). A client module because a component cannot cross the server →
 * client boundary as a prop; the root layout renders this once around the app.
 */
export function AppLinkProvider({ children }: { children: ReactNode }) {
  return <LinkComponentProvider component={Link}>{children}</LinkComponentProvider>;
}
