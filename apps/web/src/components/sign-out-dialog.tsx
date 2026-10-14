"use client";

import { Button, Dialog } from "@desiauction/ui";
import { useState } from "react";
import { scoringSignOut } from "../lib/scoring-sign-out";

/** Confirmation changes no cleanup ordering, epoch protection or logout authority. */
export function SignOutDialog({
  open,
  onClose,
  logout,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  logout: () => Promise<void>;
  onConfirm?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const close = () => {
    if (!pending) {
      setError(null);
      onClose();
    }
  };
  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      onConfirm?.();
      await scoringSignOut(logout);
      onClose();
    } catch {
      setError(
        "Sign out did not finish. Your session may still be active. Some saved device entries may already have been cleared. Try again or stay on this screen.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open
      closeDisabled={pending}
      onClose={close}
      title="Sign out and clear this device?"
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Stay signed in
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            data-testid="sign-out-confirm"
            onClick={() => {
              void submit();
            }}
          >
            {pending ? "Signing out…" : "Clear device data and sign out"}
          </Button>
        </>
      }
    >
      <p>
        Signing out removes saved match data, unsent scoring entries and saved financial action
        details from this device. Accepted server records remain.
      </p>
      <p>
        If scoring entries are waiting to sync or a financial outcome is unconfirmed, stay signed in
        and review that work before signing out.
      </p>
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
