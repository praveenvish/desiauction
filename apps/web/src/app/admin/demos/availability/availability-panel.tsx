"use client";

import {
  Button,
  Field,
  IconCalendar,
  IconLock,
  SectionCard,
  Select,
  useToast,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  addAvailabilityAction,
  addBlackoutAction,
  removeAvailabilityAction,
  removeBlackoutAction,
} from "../../../../server/admin/demo-actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Minutes past midnight back to "7:00 pm" — the same words the public page uses. */
function clock(minute: number): string {
  const hour24 = Math.floor(minute / 60);
  const minutes = minute % 60;
  const suffix = hour24 < 12 ? "am" : "pm";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${String(hour12)}:${String(minutes).padStart(2, "0")} ${suffix}`;
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

export function AvailabilityPanel({
  windows,
  blackouts,
}: {
  windows: readonly Window[];
  blackouts: readonly Blackout[];
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

  return (
    <>
      <SectionCard
        icon={<IconCalendar />}
        title="Weekly windows"
        description="All times are Indian Standard Time. A window repeats every week until you retire it; retiring one never cancels a call already booked inside it."
      >
        {/* The week at a glance: what the public page offers each day, before
            the form that changes it. Monday first, as a diary reads. */}
        <ol className="demo-week" aria-label="Published windows, by day">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const mine = windows.filter((window) => window.weekday === day);
            return (
              <li key={day} className="demo-week-day" data-open={mine.length > 0 || undefined}>
                <span className="demo-week-name">{(DAYS[day] ?? "").slice(0, 3)}</span>
                {mine.length === 0 ? (
                  <span className="demo-week-none">
                    <span aria-hidden>—</span>
                    <span className="admin-sr-only">nothing offered</span>
                  </span>
                ) : (
                  mine.map((window) => (
                    <span key={window.id} className="demo-week-slot">
                      {clock(window.startMinute)}–{clock(window.endMinute)}
                    </span>
                  ))
                )}
              </li>
            );
          })}
        </ol>
        <div className="demo-availability-form">
          <Select
            label="Day"
            value={weekday}
            onChange={(event) => {
              setWeekday(event.currentTarget.value);
            }}
          >
            {DAYS.map((day, index) => (
              <option key={day} value={String(index)}>
                {day}
              </option>
            ))}
          </Select>
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
            label="Slot length"
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
            loading={pending}
            onClick={() => {
              run(() => addAvailabilityAction(weekday, from, to, slot));
            }}
          >
            Publish
          </Button>
        </div>

        {windows.length === 0 ? null : (
          <ul className="admin-rows is-inset demo-window-list">
            {windows.map((window) => (
              <li key={window.id}>
                <span>
                  {DAYS[window.weekday] ?? "?"} · {clock(window.startMinute)} to{" "}
                  {clock(window.endMinute)} · {window.slotMinutes}-minute slots
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={pending}
                  onClick={() => {
                    run(() => removeAvailabilityAction(window.id));
                  }}
                >
                  Retire
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        icon={<IconLock />}
        tone="neutral"
        title="Blocked days"
        description="A day nothing is offered on, whatever the weekly windows say. Travel, a wedding, an auction of your own."
      >
        <div className="demo-availability-form">
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
            value={blackoutReason}
            maxLength={200}
            onChange={(event) => {
              setBlackoutReason(event.currentTarget.value);
            }}
          />
          <Button
            variant="secondary"
            loading={pending}
            onClick={() => {
              run(() => addBlackoutAction(blackoutDay, blackoutReason));
            }}
          >
            Block it
          </Button>
        </div>

        {blackouts.length === 0 ? null : (
          <ul className="admin-rows is-inset demo-window-list">
            {blackouts.map((blackout) => (
              <li key={blackout.id}>
                <span>
                  {blackout.blackoutOn}
                  {blackout.reason === null ? "" : ` · ${blackout.reason}`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={pending}
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
      </SectionCard>
    </>
  );
}
