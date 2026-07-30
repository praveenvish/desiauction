"use client";

import { Button, Dialog, type ButtonSize, type ButtonVariant } from "@desiauction/ui";
import { useState, type ReactNode } from "react";

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
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={title}
      >
        {children}
      </Dialog>
    </>
  );
}
