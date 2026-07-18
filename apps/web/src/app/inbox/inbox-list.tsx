"use client";

import { useEffect, useRef, useState } from "react";

export interface InboxEvent {
  action: string;
  at: string;
}

export const INBOX_SEEN_KEY = "da:inbox-seen-at";

const LABELS: Record<string, string> = {
  "auth.login.otp": "Signed in with a one-time code",
  "auth.login.passkey": "Signed in with a passkey",
  "auth.otp.lockout": "Too many wrong codes — sign-in was locked briefly",
  "auth.passkey.enrolled": "Passkey added",
  "auth.passkey.renamed": "Passkey renamed",
  "auth.passkey.removed": "Passkey removed",
  "auth.session.revoked": "A device was signed out",
  "profile.name.updated": "Name updated",
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Unread contract: rows newer than the device's last visit render with the
 * unread dot for THIS render, then the visit timestamp advances. Read-state is
 * presentation-only (localStorage) — no notification storage exists yet.
 */
export function InboxList({ events }: { events: InboxEvent[] }) {
  const [seenBefore, setSeenBefore] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Capture the pre-visit watermark exactly once per mount — StrictMode's
  // double-invoked effect must not read back the value it just wrote.
  const captured = useRef<{ seen: string | null } | null>(null);

  useEffect(() => {
    captured.current ??= { seen: window.localStorage.getItem(INBOX_SEEN_KEY) };
    setSeenBefore(captured.current.seen);
    setHydrated(true);
    const latest = events[0]?.at;
    if (latest !== undefined) {
      window.localStorage.setItem(INBOX_SEEN_KEY, latest);
    }
  }, [events]);

  return (
    <ol className="inbox-list" data-testid="inbox-list" data-hydrated={hydrated}>
      {events.map((event) => {
        const unread = hydrated && (seenBefore === null || event.at > seenBefore);
        return (
          <li
            key={`${event.action}-${event.at}`}
            className="inbox-row"
            data-testid="inbox-row"
            data-unread={unread}
          >
            <span className="inbox-dot" aria-hidden data-visible={unread} />
            <span className="inbox-label">
              {LABELS[event.action] ?? event.action}
              {unread ? <span className="visually-hidden"> (new)</span> : null}
            </span>
            <time className="inbox-when" dateTime={event.at}>
              {formatWhen(event.at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
