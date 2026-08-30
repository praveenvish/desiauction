"use client";

import { Button, Dialog, type ButtonSize, type ButtonVariant } from "@desiauction/ui";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * A way for the form inside to shut the dialog around it.
 *
 * Needed because the "it closes by navigating" contract below is no longer
 * true everywhere. The create forms on /home, /orgs and /tournaments render
 * inside the `@action` PARALLEL ROUTE slot, and that slot does not swap to its
 * `default` when the router moves to a route with no action — so the dialog,
 * which lives in the shell's topbar, SURVIVES the navigation and goes on
 * intercepting pointer events over the page underneath. Measured: after
 * creating an organization the destination page rendered correctly and every
 * control on it was unreachable, with Playwright naming the open <dialog> in
 * the topbar as the interceptor.
 *
 * The default is a no-op so a form rendered outside a FormDialog is unaffected.
 */
const FormDialogClose = createContext<() => void>(() => undefined);

/** Close the FormDialog this form is rendered in; a no-op outside one. */
export function useFormDialogClose(): () => void {
  return useContext(FormDialogClose);
}

/**
 * A create form in a modal.
 *
 * The pages used to scroll you to a card pinned at the bottom — a weak pattern
 * the design's own audit flagged. This opens the same form in the repo's native
 * <dialog> (focus trap, Escape, backdrop, top-layer) instead.
 *
 * The form is unchanged: it already redirects on success — which navigates the
 * page and tears the modal down with it — and returns its error via
 * useActionState, which re-renders in place with the dialog still open. So a
 * rejected name stays put and shows why; a good one closes by navigating.
 *
 * The trigger is rendered HERE, not passed in, because a server page cannot
 * hand a client onClick across the boundary. Callers pass serialisable trigger
 * config; the children (the already-client form) come through untouched.
 */
export function FormDialog({
  title,
  triggerLabel,
  children,
  variant = "primary",
  size,
  /** Render the trigger as a quiet accent link instead of a filled button. */
  triggerAsLink = false,
  triggerClassName,
  triggerTestId,
}: {
  title: string;
  triggerLabel: ReactNode;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  triggerAsLink?: boolean;
  triggerClassName?: string;
  triggerTestId?: string;
}) {
  const [open, setOpen] = useState(false);
  // Stable identity: the forms put this in a `useEffect` dependency list, and a
  // fresh arrow every render would re-run the navigation effect on every render.
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  return (
    <>
      {triggerAsLink ? (
        <button
          type="button"
          className={triggerClassName}
          onClick={() => {
            setOpen(true);
          }}
          {...(triggerTestId !== undefined ? { "data-testid": triggerTestId } : {})}
        >
          {triggerLabel}
        </button>
      ) : (
        <Button
          variant={variant}
          {...(size !== undefined ? { size } : {})}
          {...(triggerClassName !== undefined ? { className: triggerClassName } : {})}
          onClick={() => {
            setOpen(true);
          }}
          {...(triggerTestId !== undefined ? { "data-testid": triggerTestId } : {})}
        >
          {triggerLabel}
        </Button>
      )}
      <Dialog open={open} onClose={close} title={title}>
        <FormDialogClose.Provider value={close}>{children}</FormDialogClose.Provider>
      </Dialog>
    </>
  );
}
