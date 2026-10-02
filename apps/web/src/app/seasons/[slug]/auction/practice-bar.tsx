"use client";

import { Button, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  chooseRoomAction,
  practiceRoomStateAction,
  type PracticeRoom,
} from "../../../../server/auction/live-actions";

/** How often the room asks whether a practice started or ended. */
const POLL_MS = 5_000;

/**
 * THE PRACTICE BAR (0101) — the one strip that tells a room it is a rehearsal.
 *
 * While a practice runs it says so on every screen of it, with the switch to
 * step out to the real auction's waiting room and back. It also keeps the room
 * honest without anyone reloading: when the organiser starts a practice, the
 * phones waiting for the night move into it; when the practice ends — or the
 * real auction opens, which ends it — every phone in it moves to the real
 * auction by itself, with a line saying why.
 *
 * `watch` is false once the night has begun: there is nothing left to wait for.
 */
export function PracticeBar({
  slug,
  practice,
  watch,
}: {
  slug: string;
  practice: PracticeRoom | null;
  watch: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [switching, setSwitching] = useState(false);
  // The practice this screen was drawn for; a change means the room moved.
  const shown = practice?.practiceId ?? null;
  const inPractice = practice?.inPractice === true;

  useEffect(() => {
    if (!watch) {
      return;
    }
    let stopped = false;
    const tick = async () => {
      // A phone in a pocket asks nothing; it catches up the moment it is looked at.
      if (document.visibilityState !== "visible") {
        return;
      }
      let state;
      try {
        state = await practiceRoomStateAction(slug);
      } catch {
        return; // A dropped poll is retried on the next tick.
      }
      if (stopped || state === null || state.practiceId === shown) {
        return;
      }
      if (state.practiceId === null) {
        if (inPractice) {
          toast({
            title: state.realStarted
              ? "The practice is over — the real auction has started"
              : "The practice has ended",
            tone: "info",
          });
        }
      } else if (shown === null) {
        toast({ title: "A practice auction has started — try the bidding", tone: "info" });
      }
      router.refresh();
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [watch, slug, shown, inPractice, router, toast]);

  if (practice === null) {
    return null;
  }

  const choose = async (room: "practice" | "real") => {
    setSwitching(true);
    try {
      await chooseRoomAction(slug, room);
      router.refresh();
    } finally {
      setSwitching(false);
    }
  };

  return (
    <section
      className="practice-bar"
      data-room={inPractice ? "practice" : "real"}
      data-testid="practice-bar"
      aria-label="Practice auction"
    >
      <div className="practice-bar-text">
        {inPractice ? (
          <>
            <strong className="practice-bar-tag">Practice</strong>
            <span>
              Nothing here counts. Bid, run your purse down, see what happens — every purse and
              player resets when it ends.
            </span>
          </>
        ) : (
          <span>
            You&apos;re looking at the real auction&apos;s waiting room. A practice is running.
          </span>
        )}
      </div>
      <div className="practice-bar-switch" role="group" aria-label="Which auction to show">
        <Button
          size="sm"
          variant={inPractice ? "primary" : "secondary"}
          aria-pressed={inPractice}
          disabled={switching}
          onClick={() => {
            if (!inPractice) {
              void choose("practice");
            }
          }}
          data-testid="room-practice"
        >
          Practice
        </Button>
        <Button
          size="sm"
          variant={inPractice ? "secondary" : "primary"}
          aria-pressed={!inPractice}
          disabled={switching}
          onClick={() => {
            if (inPractice) {
              void choose("real");
            }
          }}
          data-testid="room-real"
        >
          Real auction
        </Button>
      </div>
    </section>
  );
}
