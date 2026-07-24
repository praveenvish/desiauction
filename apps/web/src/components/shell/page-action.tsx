"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * A page's ONE primary action, handed up to the identity bar.
 *
 * Every surface used to place its main button wherever its own layout put it —
 * top-right of a header row here, inside a card there — so the thing an
 * organizer clicks most moved between pages. Publishing it to the shell puts it
 * at the head of the utility cluster, in the same place on every surface.
 *
 * The node itself travels (not a description of it), so a page keeps its own
 * dialog, form and server action untouched — only the placement changes.
 */

export interface ShellActionChannel {
  publish: (node: ReactNode) => void;
  /** Clear only if `token` is still the published node — see ShellTitleChannel. */
  retract: (token: ReactNode) => void;
}

export const ShellActionContext = createContext<ShellActionChannel>({
  publish: () => {},
  retract: () => {},
});

/** Renders nothing where it sits; its child appears in the header. */
export function PageAction({ children }: { children: ReactNode }) {
  const { publish, retract } = useContext(ShellActionContext);
  useEffect(() => {
    publish(children);
    return () => {
      retract(children);
    };
  }, [publish, retract, children]);
  return null;
}
