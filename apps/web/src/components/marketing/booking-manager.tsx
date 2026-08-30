"use client";

import { Button } from "@desiauction/ui";
import { useActionState, useState } from "react";

import { cancelBookingAction } from "../../server/marketing/booking-actions";
import { track } from "../../lib/telemetry";
import { SlotPicker } from "./slot-picker";
import type { SlotDay } from "../../server/marketing/demo-slots";

/**
 * MOVE IT OR CALL IT OFF.
 *
 * Rescheduling is hidden behind a disclosure rather than shown as a wall of
 * times: the common case is a person opening the link to check when the call
 * is, and a fortnight of slots in front of that reads as though the booking is
 * not really made.
 *
 * Cancelling is deliberately one press with no confirmation dialog. It is
 * reversible in the only sense that matters — the demo can be booked again in a
 * minute — and a modal that makes somebody argue their way out of a sales call
 * is a dark pattern with a very short memory.
 */
export function BookingManager({ token, days }: { token: string; days: readonly SlotDay[] }) {
  const [moving, setMoving] = useState(false);
  const [state, cancelAction, pending] = useActionState(cancelBookingAction, {
    status: "idle" as const,
  });

  if (state.status === "cancelled") {
    return (
      <p className="demo-cancelled" role="status">
        Cancelled. Nobody will call — and you can ask for another time whenever suits.
      </p>
    );
  }

  return (
    <>
      {moving ? (
        days.length === 0 ? (
          <p className="demo-chosen">
            No other times are free in the next fortnight. Cancel below and we&apos;ll come back to
            you with more.
          </p>
        ) : (
          <SlotPicker days={days} token={token} submitLabel="Move to this time" />
        )
      ) : null}

      <div className="demo-booking-actions">
        {!moving ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setMoving(true);
              track("demo.rescheduled", {});
            }}
          >
            Move this demo
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setMoving(false);
            }}
          >
            Keep the time I have
          </Button>
        )}

        <form
          action={cancelAction}
          onSubmit={() => {
            track("demo.cancelled", {});
          }}
        >
          <input type="hidden" name="token" value={token} />
          <Button type="submit" variant="ghost" loading={pending}>
            Cancel the demo
          </Button>
        </form>
      </div>

      {state.status === "error" ? (
        <p className="demo-slot-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </>
  );
}
