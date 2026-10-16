"use client";
import { Button, Field } from "@desiauction/ui";
import { useActionState } from "react";
import { submitConfirmation } from "./actions";
export function ConfirmationForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitConfirmation.bind(null, token), {});
  return (
    <form action={action} className="dash-stack">
      <Field
        label="Reason or note"
        name="note"
        maxLength={500}
        help="A dispute needs a reason of at least 10 characters."
      />
      <Button type="submit" name="verdict" value="confirmed" size="touch" loading={pending}>
        Yes, that’s right
      </Button>
      <Button
        type="submit"
        name="verdict"
        value="disputed"
        size="touch"
        variant="ghost"
        loading={pending}
      >
        Something’s wrong
      </Button>
      <p role="status">
        {state.error ??
          (state.saved
            ? state.trust === "flagged"
              ? "Your response is recorded. This match remains flagged for review."
              : "Your response is recorded."
            : "")}
      </p>
    </form>
  );
}
