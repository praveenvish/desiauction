"use client";

import {
  IconAlert,
  IconBell,
  IconCheckCircle,
  IconClock,
  IconClose,
  IconCrown,
  IconDevice,
  IconGavel,
  IconKey,
  IconLock,
  IconLogOut,
  IconMail,
  IconMatch,
  IconPhone,
  IconReceipt,
  IconShieldCheck,
  IconTile,
  IconUser,
  IconUsers,
  VisuallyHidden,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { inboxSeenKey, labelForEvent } from "../../lib/inbox-events";
import { useHydrated } from "../../lib/use-hydrated";

export interface InboxEvent {
  action: string;
  at: string;
  /** What this notice is ABOUT — the competition, named and (if public) linked. */
  subject?: { name: string; href?: string };
  /**
   * The facts that make the headline worth reading — "Mumbai Indians · ₹55,000"
   * under "You were sold at auction". Server-composed from an allowlist; this
   * component renders it as text and never as markup.
   */
  detail?: string;
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
    timeZone: "Asia/Kolkata", // PRR P2/F25: pin the zone or SSR/CSR disagree
    day: "2-digit",
    month: "short",
    ...(now === null || sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * One tinted tile per kind of notice, so a list of forty reads at a glance:
 * gold for the auction, green for good news, red for the ones to look at.
 * Presentation only — an action this map does not know falls back to a bell.
 */
const EVENT_ICON: Record<string, { icon: ReactNode; tone: KitTone }> = {
  "auth.login.otp": { icon: <IconLock />, tone: "neutral" },
  "auth.login.email": { icon: <IconLock />, tone: "neutral" },
  "auth.login.passkey": { icon: <IconKey />, tone: "neutral" },
  "auth.signup.email": { icon: <IconUser />, tone: "gold" },
  "auth.otp.requested": { icon: <IconLock />, tone: "neutral" },
  "auth.otp.lockout": { icon: <IconAlert />, tone: "red" },
  "auth.passkey.enrolled": { icon: <IconKey />, tone: "purple" },
  "auth.passkey.renamed": { icon: <IconKey />, tone: "purple" },
  "auth.passkey.removed": { icon: <IconKey />, tone: "amber" },
  "auth.passkey.failed": { icon: <IconAlert />, tone: "red" },
  "auth.session.revoked": { icon: <IconDevice />, tone: "amber" },
  "auth.logout": { icon: <IconLogOut />, tone: "neutral" },
  "auth.phone.changed": { icon: <IconPhone />, tone: "amber" },
  "profile.email.verified": { icon: <IconMail />, tone: "green" },
  "profile.name.set": { icon: <IconUser />, tone: "blue" },
  "profile.name.updated": { icon: <IconUser />, tone: "blue" },
  "profile.player.updated": { icon: <IconUser />, tone: "blue" },
  "registration.approved": { icon: <IconCheckCircle />, tone: "green" },
  "registration.rejected": { icon: <IconClose />, tone: "red" },
  "registration.waitlisted": { icon: <IconClock />, tone: "amber" },
  "auction.sold": { icon: <IconGavel />, tone: "gold" },
  "auction.unsold": { icon: <IconGavel />, tone: "neutral" },
  "team.appointed": { icon: <IconCrown />, tone: "purple" },
  "team.squad_sheet": { icon: <IconUsers />, tone: "blue" },
  "fixture.lineup_announced": { icon: <IconMatch />, tone: "green" },
  "finance.document.issued": { icon: <IconReceipt />, tone: "blue" },
  "privacy.erasure.requested": { icon: <IconShieldCheck />, tone: "red" },
  "privacy.erasure.withdrawn": { icon: <IconShieldCheck />, tone: "neutral" },
};

const FALLBACK_ICON = { icon: <IconBell />, tone: "neutral" as KitTone };

/** The calendar day in IST — the same on the server and in the browser. */
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * "Today" and "Yesterday" need a clock, so they arrive with hydration like the
 * relative times do; the first paint names the date.
 */
function dayLabel(key: string, now: number | null): string {
  if (now !== null) {
    const today = dayKey(new Date(now).toISOString());
    const yesterday = dayKey(new Date(now - 86_400_000).toISOString());
    if (key === today) return "Today";
    if (key === yesterday) return "Yesterday";
  }
  const date = new Date(`${key}T12:00:00+05:30`);
  const sameYear =
    now !== null && key.slice(0, 4) === dayKey(new Date(now).toISOString()).slice(0, 4);
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(now === null || sameYear ? {} : { year: "numeric" }),
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
  const hydrated = useHydrated();
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
    setNow(Date.now());
    const latest = events[0]?.at;
    if (latest !== undefined) {
      window.localStorage.setItem(key, latest);
    }
  }, [events, personId]);

  // Consecutive notices on the same IST day share a heading.
  const groups: { key: string; events: InboxEvent[] }[] = [];
  for (const event of events) {
    const key = dayKey(event.at);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) {
      last.events.push(event);
    } else {
      groups.push({ key, events: [event] });
    }
  }

  return (
    <div className="inbox-list" data-testid="inbox-list" data-hydrated={hydrated}>
      {groups.map((group) => (
        <div key={group.key} className="inbox-day">
          <h3 className="inbox-day-title">{dayLabel(group.key, now)}</h3>
          <ol className="inbox-rows">
            {group.events.map((event) => {
              const unread = hydrated && (seenBefore === null || event.at > seenBefore);
              const label = labelForEvent(event.action);
              const look = EVENT_ICON[event.action] ?? FALLBACK_ICON;
              return (
                <li
                  key={`${event.action}-${event.at}`}
                  className="inbox-row"
                  data-testid="inbox-row"
                  data-unread={unread}
                >
                  <IconTile icon={look.icon} tone={look.tone} size="md" />
                  <span className="inbox-label">
                    <span className="inbox-headline">{label}</span>
                    {event.subject !== undefined ? (
                      <span className="inbox-subject">
                        {event.subject.href !== undefined ? (
                          <Link href={event.subject.href}>{event.subject.name}</Link>
                        ) : (
                          event.subject.name
                        )}
                      </span>
                    ) : null}
                    {event.detail !== undefined ? (
                      <span className="inbox-detail">{event.detail}</span>
                    ) : null}
                    {unread ? <VisuallyHidden> (new)</VisuallyHidden> : null}
                  </span>
                  <span className="inbox-side">
                    <time className="inbox-when" dateTime={event.at}>
                      {formatWhen(event.at, now)}
                    </time>
                    <span className="inbox-dot" aria-hidden data-visible={unread} />
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
