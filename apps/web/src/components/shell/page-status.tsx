"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { MoneyUnitProvider, useMoneyUnit } from "../money-unit";

/**
 * A live surface's status strip, handed up to the Live shell's header.
 *
 * `LiveShell` has carried a `statusSlot` since PX-2 and nothing ever filled it,
 * so every auction page drew its own status ribbon inside its own content —
 * beneath a page `<h1>` that repeated the auction's name the ribbon was about to
 * repeat again. On a 390px phone that stacked 276px of chrome above the one
 * number the room is watching, and pushed the current bid under the fold.
 *
 * The ribbon travels as a node (not a description of one), so the page keeps its
 * live socket, its snapshot and its ceremony untouched — only the placement
 * changes. Mirrors `PageAction`/`PageTitle`, including the token-guarded retract
 * so a Suspense re-reveal cannot wipe the strip a newer instance published.
 */

export interface ShellStatusChannel {
  publish: (node: ReactNode) => void;
  retract: (token: ReactNode) => void;
}

export const ShellStatusContext = createContext<ShellStatusChannel>({
  publish: () => {},
  retract: () => {},
});

/** Renders nothing where it sits; its child appears in the Live shell header. */
export function PageStatus({ children }: { children: ReactNode }) {
  const { publish, retract } = useContext(ShellStatusContext);
  // The shell renders what is published OUTSIDE this page's providers, so the
  // season's money unit did not travel with it: a points season's live header
  // read "₹1,000" while the panel under it said "1,000 pts". The unit is
  // captured here and re-provided around the published node.
  const unit = useMoneyUnit();
  const node = useMemo(
    () => <MoneyUnitProvider unit={unit}>{children}</MoneyUnitProvider>,
    [unit, children],
  );
  useEffect(() => {
    publish(node);
    return () => {
      retract(node);
    };
  }, [publish, retract, node]);
  return null;
}
