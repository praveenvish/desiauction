"use client";

import { Button, Dialog, Field } from "@desiauction/ui";
import { useState } from "react";

/**
 * ABORT — the one irreversible action on the auction desk, and until now the
 * only destructive one in the product with no confirmation at all.
 *
 * It sat as a ghost button beside "Pause" and "Complete", one mis-tap from
 * ending a live auction. The machine calls it "the catastrophic exit": it
 * freezes everything as it stands, and `abandoned` is terminal — there is no
 * command back. A conductor with a room full of people and a bidding war on the
 * screen could kill the night with a stray thumb, and the first thing they
 * would know about it is the room going quiet.
 *
 * The confirmation asks for the word rather than a yes. A yes/no dialog on a
 * touch device is two taps in the same place, which is the same mis-tap twice;
 * typing ABORT cannot happen by accident. The reason is required and rides into
 * the event, because "who ended this and why" is the first question the next
 * morning.
 */
export function AbortDialog({
  onAbort,
  busy,
}: {
  onAbort: (reason: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setTyped("");
    setReason("");
    setError(null);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="touch"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="auction-abort"
      >
        Abort
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Abort this auction?"
        footer={
          <>
            <Button variant="secondary" size="touch" onClick={close}>
              Keep going
            </Button>
            <Button
              variant="danger"
              size="touch"
              loading={busy}
              data-testid="auction-abort-confirm"
              onClick={() => {
                if (typed.trim().toUpperCase() !== "ABORT") {
                  setError("Type ABORT to confirm.");
                  return;
                }
                if (reason.trim() === "") {
                  setError("Give a reason — it goes on the record.");
                  return;
                }
                onAbort(reason.trim());
                close();
              }}
            >
              Abort auction
            </Button>
          </>
        }
      >
        <p>
          {/* Said in the room's terms, not the machine's. "Terminal state" means
              nothing at 10pm; "there is no way back" does. */}
          This ends the night where it stands. Sold lots stay sold, everything unsold stays unsold,
          and there is no way to restart or resume — this auction can never go live again.
        </p>
        <p>If you only need to stop for a while, close this and use Pause instead.</p>
        <Field
          label="Type ABORT to confirm"
          name="confirm"
          value={typed}
          autoComplete="off"
          data-testid="auction-abort-typed"
          onChange={(event) => {
            setTyped(event.target.value);
            setError(null);
          }}
        />
        <Field
          label="Reason"
          name="reason"
          value={reason}
          help="Goes into the auction's event log."
          data-testid="auction-abort-reason"
          {...(error !== null ? { error } : {})}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
        />
      </Dialog>
    </>
  );
}
