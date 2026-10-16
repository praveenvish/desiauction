"use client";

import { Button, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  realStarted,
}: {
  slug: string;
  practice: PracticeRoom | null;
  watch: boolean;
  /** The night has begun (the real auction left `scheduled`). */
  realStarted: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [switching, setSwitching] = useState(false);
  // The practice this screen was drawn for; a change means the room moved.
  const shown = practice?.practiceId ?? null;
  const inPractice = practice?.inPractice === true;

  /*
   * SAY WHY THE ROOM MOVED — however it moved. The poll below is one way a
   * screen learns the practice ended; the live room's own socket (a snapshot
   * of the aborted practice) is often faster and refreshes the page itself.
   * So the words are tied to what the screen SHOWS changing, not to who
   * noticed first: whenever this screen goes from inside a practice to none,
   * or from none to one, it says so once.
   */
  const before = useRef({ shown, inPractice });
  useEffect(() => {
    const was = before.current;
    before.current = { shown, inPractice };
    if (was.shown === shown) {
      return;
    }
    if (shown === null && was.inPractice) {
      toast({
        title: realStarted
          ? "The practice is over — the real auction has started"
          : "The practice has ended",
        tone: "info",
      });
    } else if (was.shown === null && shown !== null && inPractice) {
      toast({ title: "A practice auction has started — try the bidding", tone: "info" });
    }
  }, [shown, inPractice, realStarted, toast]);

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
      // The refresh redraws the room; the effect above says what changed.
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
  }, [watch, slug, shown, router]);

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
