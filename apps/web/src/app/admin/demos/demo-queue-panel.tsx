"use client";

import { Badge, Button, Card, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DEMAND_SPORTS, demandSportBadge } from "../../../content/demand-sports";
import { answerDemoRequestAction, cancelDemoAction } from "../../../server/admin/demo-actions";
import type { DemoQueue, DemoQueueRow } from "../../../server/admin/demo-views";

/**
 * ANSWERING, WITH THE FACTS IN FRONT OF YOU.
 *
 * Each row carries what actually decides how to approach the call — the size of
 * the tournament, how soon their auction is, when they said they are free — and
 * the note in full, unabridged. A queue that hides the note makes the operator
 * open every row to find out which of them is urgent.
 *
 * "Their auction is in nine days" is the single most useful fact on this page
 * and it is computed here rather than left as a date to subtract in your head.
 */
export function DemoQueuePanel({ queue }: { queue: DemoQueue }) {
  return (
    <>
      {queue.upcoming.length > 0 ? (
        <Card data-testid="demo-queue-upcoming">
          <h2>Booked in</h2>
          <ul className="demo-queue">
            {queue.upcoming.map((row) => (
              <DemoRow key={`upcoming-${row.id}`} row={row} showCancel />
            ))}
          </ul>
        </Card>
      ) : null}

      {queue.open.length > 0 ? (
        <Card data-testid="demo-queue-open">
          <h2>Waiting for an answer</h2>
          <ul className="demo-queue">
            {queue.open.map((row) => (
              <DemoRow key={`open-${row.id}`} row={row} />
            ))}
          </ul>
        </Card>
      ) : null}

      {queue.answered.length > 0 ? (
        <Card data-testid="demo-queue-answered">
          <h2>Answered</h2>
          <ul className="demo-answered">
            {queue.answered.map((row) => (
              <li key={`answered-${row.id}`}>
                <span className="demo-answered-org">{row.orgName}</span>
                <span className="competitions-hint">
                  {(row.outcome ?? "").replace("_", " ")}
                  {row.contactedAt === null
                    ? ""
                    : ` · ${row.contactedAt.toISOString().slice(0, 10)}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

const SIZE_WORDS: Record<string, string> = {
  "under-8": "under 8 teams",
  "8-16": "8–16 teams",
  "16-32": "16–32 teams",
  "over-32": "32+ teams",
  unsure: "size unknown",
};

/**
 * The words for the SP-1 gate's answer, DERIVED from the one list rather than
 * retyped here.
 *
 * This map was the third copy, and it was stale in exactly the way the form
 * was: it still keyed on `table-tennis`, renamed `table_tennis` in 0057, and
 * had never heard of `box_cricket` or `battle_royale`. The failure mode is
 * quiet — an unknown key falls through to the raw string — so the operator
 * counting demand read `table_tennis` in a row of ordinary words and had no
 * reason to think anything was wrong.
 *
 * `cricket` is NOT dropped as the unremarkable case: an operator reading this
 * queue is counting, and a badge that appears only for the interesting answers
 * makes "cricket" and "asked before we asked the question" look identical.
 */
const SPORT_WORDS: Record<string, string> = Object.fromEntries(
  DEMAND_SPORTS.map((sport) => [sport.key, demandSportBadge(sport)]),
);

const WINDOW_WORDS: Record<string, string> = {
  "weekday-evening": "weekday evenings",
  "weekend-morning": "weekend mornings",
  "weekend-evening": "weekend evenings",
  any: "any time",
};

const OUTCOMES: readonly { value: string; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "showed", label: "Showed up" },
  { value: "no_show", label: "No-show" },
  { value: "signed_up", label: "Signed up" },
  { value: "not_a_fit", label: "Not a fit" },
  { value: "no_response", label: "No response" },
];

/** Days until their auction — negative is impossible (the form refuses a past date). */
function daysAway(day: string): number {
  const target = Date.parse(`${day}T00:00:00Z`);
  return Math.round((target - Date.now()) / 86_400_000);
}

function DemoRow({ row, showCancel = false }: { row: DemoQueueRow; showCancel?: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

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

  const urgency = row.auctionOn === null ? null : daysAway(row.auctionOn);

  return (
    <li className="demo-row" id={row.id} data-testid={`demo-request-${row.id}`}>
      <div className="demo-row-head">
        <div>
          <p className="demo-row-org">{row.orgName}</p>
          <p className="competitions-hint">
            {row.name} · <a href={`tel:${row.phone}`}>{row.phone}</a>
            {row.email === null ? null : (
              <>
                {" · "}
                <a href={`mailto:${row.email}`}>{row.email}</a>
              </>
            )}
          </p>
        </div>
        <div className="demo-row-tags">
          {/* First, because which sport they run changes how the rest reads. A
              request taken before migration 0045 has no answer, and says so
              rather than being quietly counted as cricket. */}
          <Badge tone={row.sport === null ? "neutral" : "info"}>
            {row.sport === null ? "sport not asked" : (SPORT_WORDS[row.sport] ?? row.sport)}
          </Badge>
          <Badge tone="neutral">{SIZE_WORDS[row.tournamentSize] ?? row.tournamentSize}</Badge>
          {urgency !== null ? (
            <Badge tone={urgency <= 14 ? "danger" : urgency <= 30 ? "warning" : "neutral"}>
              auction in {urgency} {urgency === 1 ? "day" : "days"}
            </Badge>
          ) : (
            <Badge tone="neutral">no auction date</Badge>
          )}
          <Badge tone="neutral">{WINDOW_WORDS[row.preferredWindow] ?? row.preferredWindow}</Badge>
        </div>
      </div>

      {row.slotStart !== null ? (
        <p className="demo-row-slot">
          Booked for {row.slotStart.toISOString().replace("T", " ").slice(0, 16)} UTC
        </p>
      ) : null}

      {row.note === null ? null : <p className="demo-row-note">{row.note}</p>}

      <div className="demo-row-actions">
        {open ? (
          OUTCOMES.map((outcome) => (
            <Button
              key={outcome.value}
              size="sm"
              variant="secondary"
              loading={pending}
              onClick={() => {
                run(() => answerDemoRequestAction(row.id, outcome.value));
              }}
            >
              {outcome.label}
            </Button>
          ))
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setOpen(true);
            }}
          >
            Record what happened
          </Button>
        )}
        {showCancel ? (
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            onClick={() => {
              run(() => cancelDemoAction(row.id));
            }}
          >
            Cancel the call
          </Button>
        ) : null}
      </div>
    </li>
  );
}
