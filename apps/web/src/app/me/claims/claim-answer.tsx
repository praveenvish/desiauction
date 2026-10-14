"use client";
import { Button } from "@desiauction/ui";
import { useActionState } from "react";
import { answerClaim } from "./actions";

export function ClaimAnswer({ noticeId }: { noticeId: string }) {
  const [state, action, pending] = useActionState(answerClaim.bind(null, noticeId), {});
  if (state.answered)
    return (
      <p role="status">
        {state.answered === "accepted"
          ? "Done — the match stats are now part of your career."
          : "Noted. Nothing was changed."}
      </p>
    );
  return (
    <form action={action} className="dash-stack">
      <Button type="submit" name="answer" value="accept" size="touch" loading={pending}>
        Yes, that was me
      </Button>
      <Button
        type="submit"
        name="answer"
        value="decline"
        size="touch"
        variant="ghost"
        loading={pending}
      >
        Not me
      </Button>
      <p role="status">{state.error ?? ""}</p>
    </form>
  );
}
