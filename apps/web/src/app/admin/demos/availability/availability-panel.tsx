"use client";

import { Button, Card, Field, Select, useToast } from "@desiauction/ui";
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
      <Card>
        <h2>Weekly windows</h2>
        <p className="competitions-hint">
          All times are Indian Standard Time. A window repeats every week until you retire it;
          retiring one never cancels a call already booked inside it.
        </p>

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

        <ul className="demo-window-list">
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
      </Card>

      <Card>
        <h2>Blocked days</h2>
        <p className="competitions-hint">
          A day nothing is offered on, whatever the weekly windows say. Travel, a wedding, an
          auction of your own.
        </p>

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

        <ul className="demo-window-list">
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
      </Card>
    </>
  );
}
