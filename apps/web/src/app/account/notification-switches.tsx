"use client";

import { useAnnouncer } from "@desiauction/ui";
import { useState, useTransition } from "react";

import {
  setNotificationPreferenceAction,
  type NotificationSettings,
} from "../../server/messaging/actions";

/**
 * The switches the Notifications card used to say it could not offer.
 *
 * That card said, honestly, that stopping registration SMS was handled "by a
 * person, not a switch — we would rather tell you that than show you a toggle
 * that does nothing". The toggle now does something: `maySend` reads these
 * rows before every send, so switching one off stops the message rather than
 * recording a preference nobody consults.
 *
 * Sign-in codes are deliberately absent from this list. They never pass the
 * preference gate, because someone who switches off "SMS" and then cannot log
 * in has been handed a worse outcome than the one they were avoiding — and a
 * switch that silently exempts itself would be the dishonest version of that.
 */
export function NotificationSwitches({ settings }: { settings: NotificationSettings }) {
  const announce = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(
    () => new Map(settings.topics.map((entry) => [entry.topic, entry.allowed])),
  );
  const [error, setError] = useState<string | null>(null);

  const toggle = (topic: string, label: string, next: boolean) => {
    // Optimistic, then reconciled. A switch that waits on a round-trip before
    // moving reads as broken on a slow connection, which is most of them here.
    setState((current) => new Map(current).set(topic, next));
    setError(null);
    startTransition(async () => {
      const result = await setNotificationPreferenceAction(topic, next);
      if (result.ok) {
        announce(next ? `${label} turned on` : `${label} turned off`, "polite");
        return;
      }
      setState((current) => new Map(current).set(topic, !next));
      setError(result.error ?? "That did not save. Try again.");
    });
  };

  return (
    <div className="notify-switches" data-testid="notification-switches">
      {settings.topics.map((entry) => {
        const on = state.get(entry.topic) ?? entry.allowed;
        return (
          <label key={entry.topic} className="notify-switch" htmlFor={`notify-${entry.topic}`}>
            <input
              id={`notify-${entry.topic}`}
              type="checkbox"
              checked={on}
              disabled={pending}
              data-testid={`notify-${entry.topic}`}
              onChange={(event) => {
                toggle(entry.topic, entry.label, event.target.checked);
              }}
            />
            <span className="notify-switch-text">
              <span className="notify-switch-label">{entry.label}</span>
              <span className="notify-switch-detail">{entry.detail}</span>
            </span>
          </label>
        );
      })}
      {error !== null ? (
        <p role="alert" className="notify-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
