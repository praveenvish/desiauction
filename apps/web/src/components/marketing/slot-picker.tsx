"use client";

import { Button } from "@desiauction/ui";
import { useActionState, useState } from "react";

import { bookSlotAction, rescheduleBookingAction } from "../../server/marketing/booking-actions";
import { track } from "../../lib/telemetry";
import type { SlotActionState } from "../../server/marketing/booking-actions";
import type { SlotDay } from "../../server/marketing/demo-slots";

/**
 * PICKING A TIME.
 *
 * A list of days, each a list of times — not a month grid. A grid is the right
 * shape for choosing among thirty days and the wrong shape for choosing among
 * the six evenings somebody is actually free, and on a 360px phone it is a
 * squeeze that helps nobody.
 *
 * The selected slot rides a real radio group, so the keyboard behaviour (arrow
 * keys within the group, one tab stop for the whole thing) and the announced
 * state are the browser's rather than ours. The buttons are styled labels over
 * those radios — no ARIA is added on top, because a radio already says
 * everything a listener needs and anything layered over it can only disagree.
 */
export function SlotPicker({
  days,
  requestId,
  token,
  submitLabel,
}: {
  days: readonly SlotDay[];
  requestId?: string;
  token?: string;
  submitLabel: string;
}) {
  // One hook, one state shape (`SlotActionState`) — which action it drives is
  // decided by whether there is a token to move. Two hooks behind a condition
  // would be two hooks behind a condition.
  const [state, formAction, pending] = useActionState<SlotActionState, FormData>(
    token !== undefined ? rescheduleBookingAction : bookSlotAction,
    { status: "idle" },
  );
  const [chosen, setChosen] = useState<string | null>(null);

  const chosenSlot = days.flatMap((day) => day.slots).find((slot) => slot.startIso === chosen);
  const chosenDay = days.find((day) => day.slots.some((slot) => slot.startIso === chosen));

  return (
    <form action={formAction}>
      {requestId !== undefined ? <input type="hidden" name="requestId" value={requestId} /> : null}
      {token !== undefined ? <input type="hidden" name="token" value={token} /> : null}
      <input type="hidden" name="slotStart" value={chosen ?? ""} />

      <p className="demo-zone">All times are Indian Standard Time (IST).</p>

      {days.map((day) => (
        <fieldset key={day.dayKey} className="demo-day">
          <legend className="demo-day-head">{day.label}</legend>
          <ul className="demo-slots">
            {day.slots.map((slot) => {
              const id = `slot-${slot.startIso}`;
              return (
                <li key={slot.startIso}>
                  {/* The radio is the control; the label is the target. Both
                      carry the same 44px minimum, and the radio itself is
                      visually hidden rather than display:none — hiding it
                      outright takes it out of the accessibility tree and the
                      group stops being a group. */}
                  <input
                    type="radio"
                    id={id}
                    name="slotChoice"
                    value={slot.startIso}
                    checked={chosen === slot.startIso}
                    onChange={() => {
                      setChosen(slot.startIso);
                      track("demo.slot_picked", { day: day.dayKey });
                    }}
                    className="visually-hidden-input"
                  />
                  {/* No `aria-pressed`, and its absence is deliberate: it is
                      not an allowed attribute on a label — a critical WCAG
                      4.1.2 violation the axe scan caught — and it duplicated
                      state the radio already carries correctly. Selection is
                      styled from the input's own `:checked`, which is both the
                      accessible source of truth and one less thing to sync. */}
                  <label htmlFor={id} className="demo-slot">
                    {slot.label}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      <div className="demo-confirm-bar">
        <p className="demo-chosen">
          {chosenSlot === undefined || chosenDay === undefined
            ? "Pick a time above."
            : `${chosenDay.label} at ${chosenSlot.label} IST`}
        </p>
        <Button type="submit" size="lg" loading={pending} disabled={chosen === null}>
          {submitLabel}
        </Button>
      </div>

      {state.status === "error" ? (
        <p className="demo-slot-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
