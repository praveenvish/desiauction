"use client";

import { useAnnouncer } from "@desiauction/ui";
import { useState, useTransition } from "react";

import {
  setOrgMessagingSettingAction,
  type OrgMessagingSettings,
} from "../../../server/messaging/actions";

/**
 * What this club sends, as distinct from what one person wants told to them.
 *
 * The distinction is the point, and the copy below says it out loud rather than
 * leaving an organizer to assume the switch is more powerful than it is:
 * turning a topic off here stops the club sending it, and turning one ON cannot
 * override somebody who turned it off for themselves. `maySend` reads the
 * person's answer first and returns before it reaches these rows.
 *
 * Texts and emails both: since the personal messages (auction results,
 * appointments, squad sheets) a club reaches its players by email as well, and
 * a switch that stopped only the text would promise more than it does. A text
 * is SMS or WhatsApp — one row, one switch. The state shown is every row the
 * switch writes (`orgSwitchesFor`), not the SMS row alone, and the topics are
 * the catalogue's club-controllable ones — only switches some send obeys. The
 * in-app ledger is the person's own and is not the club's to switch off.
 */
export function MessagingSwitches({
  slug,
  settings,
}: {
  slug: string;
  settings: OrgMessagingSettings;
}) {
  const announce = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(
    () => new Map(settings.topics.map((entry) => [entry.topic, entry.enabled])),
  );
  const [error, setError] = useState<string | null>(null);

  const toggle = (topic: string, label: string, next: boolean) => {
    // Optimistic, then reconciled — the same contract as the account switches.
    setState((current) => new Map(current).set(topic, next));
    setError(null);
    startTransition(async () => {
      const result = await setOrgMessagingSettingAction(slug, topic, next);
      if (result.ok) {
        announce(next ? `${label} turned on` : `${label} turned off`, "polite");
        return;
      }
      setState((current) => new Map(current).set(topic, !next));
      setError(result.error ?? "That did not save. Try again.");
    });
  };

  return (
    <div className="notify-switches" data-testid="org-messaging-switches">
      {settings.topics.map((entry) => {
        const on = state.get(entry.topic) ?? entry.enabled;
        return (
          <label key={entry.topic} className="notify-switch" htmlFor={`org-notify-${entry.topic}`}>
            <input
              id={`org-notify-${entry.topic}`}
              type="checkbox"
              checked={on}
              /*
               * Read-only for anyone without `org.manage`, and shown rather than
               * hidden. A member who cannot change this still needs to know what
               * their club sends on their behalf — and a disabled control that
               * says why is more honest than an absent one that leaves them
               * wondering whether the setting exists.
               */
              disabled={pending || !settings.canManage}
              data-testid={`org-notify-${entry.topic}`}
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
