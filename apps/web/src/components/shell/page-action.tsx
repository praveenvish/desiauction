"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * A page's ONE primary action, handed up to the identity bar — as an OVERRIDE.
 *
 * Every surface used to place its main button wherever its own layout put it —
 * top-right of a header row here, inside a card there — so the thing an
 * organizer clicks most moved between pages. Publishing it to the shell puts it
 * at the head of the utility cluster, in the same place on every surface.
 *
 * IT IS NO LONGER HOW THE FIRST ACTION ARRIVES. `publish` runs in an effect,
 * and effects do not run on the server, so the first paint had no action and
 * hydration inserted one — which on a phone gave the action a row of its own
 * and pushed the page down ~106px. Measured on a production build, that was
 * CLS 0.123–0.154 on every console surface carrying an action. The action now
 * comes from the `@action` parallel route (app/@action/), which the router
 * resolves alongside the page and hands to the layout, so it is in the server's
 * HTML and the bar never changes height.
 *
 * What is left for this channel is the case a route slot genuinely cannot
 * serve: an action that follows CLIENT state. /tournaments swaps
 * "New tournament" for "New season" when the view toggles, and the shell
 * prefers whatever is published over what the server sent. The two are the same
 * control at the same size, so that swap moves nothing.
 *
 * A new surface should add a slot under `app/@action/`, not reach for this.
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
