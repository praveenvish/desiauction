"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { PublicAccessProof } from "../../../../../server/scoring/public";
import { tossReminderAction } from "../../../../../server/scoring/toss-reminder-actions";
import { PushDeviceSwitch } from "../../../../account/notification-switches";
export function TossReminder({
  fixtureId,
  proof,
  signedIn,
  pushKey,
}: {
  fixtureId: string;
  proof: PublicAccessProof;
  signedIn: boolean;
  pushKey: string | null;
}) {
  const [pending, start] = useTransition();
  const [requested, setRequested] = useState(false);
  const [email, setEmail] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!signedIn)
    return (
      <Link data-testid="live-follow" href="/login">
        Sign in to remind me at the toss
      </Link>
    );
  return (
    <div className="live-reminder">
      <h3>Remind me at the toss</h3>
      {pushKey ? (
        <PushDeviceSwitch publicKey={pushKey} />
      ) : (
        <p>Browser notifications are not available here. You can use your verified email.</p>
      )}
      <label>
        <input
          type="checkbox"
          checked={email}
          onChange={(event) => {
            setEmail(event.target.checked);
          }}
        />
        Email me once when the toss has happened.
      </label>
      <p>Uses the verified email on your account.</p>
      <button
        data-testid="live-follow"
        disabled={pending}
        onClick={() => {
          start(async () => {
            setMessage(null);
            try {
              const result = await tossReminderAction({
                fixtureId,
                proof,
                channel: email ? "email" : "push",
                consent: email || pushKey !== null,
                cancel: requested,
              });
              if (result.ok) {
                setRequested(!requested);
                setMessage(requested ? "Reminder cancelled" : "Reminder requested");
              } else setMessage("error" in result ? result.error : "That did not save. Try again.");
            } catch {
              setMessage("That did not save. Try again.");
            }
          });
        }}
      >
        {requested ? "Cancel reminder" : "Remind me at the toss"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
