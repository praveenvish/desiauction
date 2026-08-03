"use client";

import { VisuallyHidden } from "@desiauction/ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { inboxSeenKey, labelForEvent } from "../../lib/inbox-events";

export interface InboxEvent {
  action: string;
  at: string;
  /** What this notice is ABOUT — the competition, named and (if public) linked. */
  subject?: { name: string; href?: string };
}

/**
 * `now` is null until the browser has hydrated. The server cannot render "3
 * hours ago" — by the time the HTML arrives it may not be true, and it would
 * mismatch on hydration — so the first paint is always the absolute form and
 * the relative form arrives with the effect below.
 */
function formatWhen(iso: string, now: number | null): string {
  const date = new Date(iso);
  if (now !== null) {
    const ms = now - date.getTime();
    // A relative form for the recent past, because "02 Aug, 4:15 pm" makes a
    // reader do arithmetic to answer the only question they have: is this new?
    if (ms >= 0 && ms < 60_000) {
      return "just now";
    }
    if (ms >= 0 && ms < 3_600_000) {
      const minutes = Math.floor(ms / 60_000);
      return minutes <= 1 ? "1 min ago" : `${String(minutes)} min ago`;
    }
    if (ms >= 0 && ms < 86_400_000) {
      const hours = Math.floor(ms / 3_600_000);
      return hours === 1 ? "1 hour ago" : `${String(hours)} hours ago`;
    }
  }
  // A notice from last August read exactly like one from this August.
  const sameYear = now !== null && date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(now === null || sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Unread contract: rows newer than the device's last visit render with the
 * unread dot for THIS render, then the visit timestamp advances. Read-state is
 * presentation-only (localStorage) — no notification storage exists yet — but
 * the key is namespaced by personId, so one account's reading position can
 * never mark another account's notices as read on a shared handset.
 */
export function InboxList({ personId, events }: { personId: string; events: InboxEvent[] }) {
  const [seenBefore, setSeenBefore] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Rendered on the client only: a server-rendered "3 hours ago" is stale by
  // the time it reaches the browser and mismatches on hydration.
  const [now, setNow] = useState<number | null>(null);
  // Capture the pre-visit watermark exactly once per mount — StrictMode's
  // double-invoked effect must not read back the value it just wrote.
  const captured = useRef<{ seen: string | null } | null>(null);

  useEffect(() => {
    const key = inboxSeenKey(personId);
    captured.current ??= { seen: window.localStorage.getItem(key) };
    setSeenBefore(captured.current.seen);
    setHydrated(true);
    setNow(Date.now());
    const latest = events[0]?.at;
    if (latest !== undefined) {
      window.localStorage.setItem(key, latest);
    }
  }, [events, personId]);

  return (
    <ol className="inbox-list" data-testid="inbox-list" data-hydrated={hydrated}>
      {events.map((event) => {
        const unread = hydrated && (seenBefore === null || event.at > seenBefore);
        const label = labelForEvent(event.action);
        return (
          <li
            key={`${event.action}-${event.at}`}
            className="inbox-row"
            data-testid="inbox-row"
            data-unread={unread}
          >
            <span className="inbox-dot" aria-hidden data-visible={unread} />
            <span className="inbox-label">
              {label}
              {event.subject !== undefined ? (
                <span className="inbox-subject">
                  {event.subject.href !== undefined ? (
                    <Link href={event.subject.href}>{event.subject.name}</Link>
                  ) : (
                    event.subject.name
                  )}
                </span>
              ) : null}
              {unread ? <VisuallyHidden> (new)</VisuallyHidden> : null}
            </span>
            <time className="inbox-when" dateTime={event.at}>
              {formatWhen(event.at, now)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
