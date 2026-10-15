"use client";

import type { ReactNode } from "react";

/** Keep Flight lazy-child resolution on a component fiber, not the enclosing host.
 * Next 15's bundled renderer cannot rewind a claimed host on immediate replay.
 * This boundary preserves server markup and returns the child without a fallback.
 */
export function OpaqueContent({ children }: { children: ReactNode }) {
  return children;
}
