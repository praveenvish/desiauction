"use client";

import {
  Button,
  Field,
  IconExternal,
  IconLock,
  IconPlus,
  IconClose,
  SectionCard,
  Select,
  useToast,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import {
  addAvailabilityAction,
  addBlackoutAction,
  removeAvailabilityAction,
  removeBlackoutAction,
} from "../../../../server/admin/demo-actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, as a diary reads. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** Minutes past midnight back to "7:00 pm" — the same words the public page uses. */
function clock(minute: number): string {
  const hour24 = Math.floor(minute / 60);
  const minutes = minute % 60;
  const suffix = hour24 < 12 ? "am" : "pm";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${String(hour12)}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** "2026-10-02" → "Thu 2 Oct" — the public page's day words (demo-slots `dayLabel`). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayWords(dayKey: string): string {
  const at = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return dayKey;
  return `${(DAYS[at.getUTCDay()] ?? "").slice(0, 3)} ${String(at.getUTCDate())} ${MONTHS[at.getUTCMonth()] ?? ""}`;
}

interface Window {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
}

interface Blackout {
  id: string;
  blackoutOn: string;
  reason: string | null;
}

/** What /schedule-demo offers right now; null when the read failed. */
export interface Offer {
  slots: number;
  horizonDays: number;
  /** "Tue 30 Sep, 7:00 pm". */
  next: string | null;
}

/**
 * THE HOURS SOMEBODY WILL ANSWER A CALL (redesign 2026-09-28).
 *
 * One question first — what is the public page offering right now — and then
 * the week, which IS the editor: each day holds its windows (× retires one)
 * and offers "Add hours". There used to be seven grey boxes holding a dash,
 * a form apart from them, and the same windows listed a second time below.
 */
export function AvailabilityPanel({
  windows,
  blackouts,
  offer,
}: {
  windows: readonly Window[];
  blackouts: readonly Blackout[];
  offer: Offer | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [weekday, setWeekday] = useState("2");
  const [from, setFrom] = useState("19:00");
  const [to, setTo] = useState("21:00");
  const [slot, setSlot] = useState("30");
  const [blackoutDay, setBlackoutDay] = useState("");
  const [blackoutReason, setBlackoutReason] = useState("");
  const formRef = useRef<HTMLDivElement>(null);

  const run = (work: () => Promise<{ ok: boolean; summary?: string; error?: string }>) => {
    start(async () => {
      const result = await work();
      if (!result.ok) {
        toast({ title: result.error ?? "That didn't work.", tone: "danger" });
        return;
      }
      toast({ title: result.summary ?? "Done.", tone: "success" });
      router.refresh();
    });
  };

  const addTo = (day: number) => {
    setWeekday(String(day));
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    formRef.current?.querySelector<HTMLButtonElement>(`[data-day="${String(day)}"]`)?.focus();
  };

  const live = offer !== null && offer.slots > 0;

  return (
    <>
      {/* What /schedule-demo promises this minute. Empty is a working state:
          the page then says a person replies within a working day. */}
      <section
        className="demo-offer"
        data-live={live || undefined}
        aria-labelledby="demo-offer-title"
        data-testid="demo-offer"
      >
        <div className="demo-offer-text">
          <span className="demo-offer-eyebrow">The demo page is offering</span>
          <h2 id="demo-offer-title" className="demo-offer-title">
            {offer === null
              ? "We could not read the calendar"
              : live
                ? `${String(offer.slots)} ${offer.slots === 1 ? "slot" : "slots"} in the next ${String(offer.horizonDays)} days`
                : "A reply within a working day"}
          </h2>
          <p className="demo-offer-sub">
            {offer === null
              ? "The public page falls back to promising a reply within a working day."
              : live
                ? `${offer.next !== null ? `Next: ${offer.next}. ` : ""}Booked slots, blocked days and the next two hours are already left out.`
                : windows.length === 0
                  ? "No hours are published, so visitors leave a number and a person calls back. That is a working state — publish only hours you will keep."
                  : "Hours are published, but none fall in the next two weeks once bookings and blocked days are taken out."}
          </p>
        </div>
        <a
          className="demo-offer-link"
          href="/schedule-demo"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the demo page
          <IconExternal size={14} />
        </a>
      </section>

      <SectionCard
        title="Weekly hours"
        description="Indian Standard Time. Hours repeat every week until you retire them; retiring never cancels a call already booked."
        data-testid="demo-week-card"
      >
        {/* The week IS the editor: each day's windows, retired in place, and
            a door to add more. */}
        <ol className="demo-week" aria-label="Published hours, by day">
          {WEEK.map((day) => {
            const mine = windows.filter((window) => window.weekday === day);
            const name = DAYS[day] ?? "";
            return (
              <li key={day} className="demo-week-day" data-open={mine.length > 0 || undefined}>
                <span className="demo-week-name">{name.slice(0, 3)}</span>
                <span className="demo-week-slots">
                  {mine.length === 0 ? (
                    <span className="demo-week-none">Nothing offered</span>
                  ) : (
                    mine.map((window) => (
                      <span key={window.id} className="demo-week-slot">
                        {/* Each time whole on its line: "9:00 / pm" broke mid-time. */}
                        <span className="demo-week-time">
                          <span>{clock(window.startMinute)} –</span>{" "}
                          <span>{clock(window.endMinute)}</span>
                        </span>
                        <span className="demo-week-len">{window.slotMinutes}-min slots</span>
                        <button
                          type="button"
                          className="demo-week-retire"
                          disabled={pending}
                          aria-label={`Retire ${name} ${clock(window.startMinute)} to ${clock(window.endMinute)}`}
                          onClick={() => {
                            run(() => removeAvailabilityAction(window.id));
                          }}
                        >
                          <IconClose size={14} />
                        </button>
                      </span>
                    ))
                  )}
                </span>
                <button
                  type="button"
                  className="demo-week-add"
                  onClick={() => {
                    addTo(day);
                  }}
                >
                  <IconPlus size={14} />
                  Add hours
                  <span className="admin-sr-only"> on {name}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="demo-add" ref={formRef}>
          <div className="demo-add-days" role="group" aria-label="Day">
            <span className="demo-add-label" aria-hidden>
              Day
            </span>
            <span className="demo-add-day-row">
              {WEEK.map((day) => (
                <button
                  key={day}
                  type="button"
                  data-day={day}
                  className="demo-add-day"
                  aria-pressed={weekday === String(day)}
                  aria-label={DAYS[day]}
                  onClick={() => {
                    setWeekday(String(day));
                  }}
                >
                  {(DAYS[day] ?? "").slice(0, 3)}
                </button>
              ))}
            </span>
          </div>
          <Field
            label="From"
            type="time"
            value={from}
            onChange={(event) => {
              setFrom(event.currentTarget.value);
            }}
          />
          <Field
            label="To"
            type="time"
            value={to}
            onChange={(event) => {
              setTo(event.currentTarget.value);
            }}
          />
          <Select
            label="Slots"
            value={slot}
            onChange={(event) => {
              setSlot(event.currentTarget.value);
            }}
          >
            <option value="20">20 minutes</option>
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">An hour</option>
          </Select>
          <Button
            size="touch"
            loading={pending}
            onClick={() => {
              run(() => addAvailabilityAction(weekday, from, to, slot));
            }}
          >
            Publish
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        icon={<IconLock />}
        tone="neutral"
        title="Blocked days"
        description="Nothing is offered on these, whatever the weekly hours say."
        flush
        data-testid="demo-blocked-card"
      >
        {blackouts.length === 0 ? null : (
          <ul className="demo-blocked">
            {blackouts.map((blackout) => (
              <li key={blackout.id}>
                <strong>{dayWords(blackout.blackoutOn)}</strong>
                <span className="demo-blocked-why">{blackout.reason ?? ""}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={pending}
                  aria-label={`Unblock ${dayWords(blackout.blackoutOn)}`}
                  onClick={() => {
                    run(() => removeBlackoutAction(blackout.id));
                  }}
                >
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="demo-add demo-block-form">
          <Field
            label="Date"
            type="date"
            value={blackoutDay}
            onChange={(event) => {
              setBlackoutDay(event.currentTarget.value);
            }}
          />
          <Field
            label="Why (optional)"
            placeholder="Travel, a wedding…"
            value={blackoutReason}
            maxLength={200}
            onChange={(event) => {
              setBlackoutReason(event.currentTarget.value);
            }}
          />
          <Button
            variant="secondary"
            size="touch"
            loading={pending}
            onClick={() => {
              run(() => addBlackoutAction(blackoutDay, blackoutReason));
            }}
          >
            Block the day
          </Button>
        </div>
      </SectionCard>
    </>
  );
}
