"use client";

import type { CeremonyState } from "@desiauction/core";
import { useSoundCue, type SoundCue } from "@desiauction/ui";
import { useEffect, useRef } from "react";

// THE ROOM'S EAR — the ceremony as sound (doc 11 "Sound (foundation)").
//
// Cues are keyed on the ceremony's moment, the same `key` that keys every
// visual transition, so a bid that lands as one frame on the cockpit is one
// tick in the hall. The engine is inert until the person has switched sound on
// and the browser has been unlocked by that click, so nothing here checks
// anything; `play` is a no-op until both are true.
//
// Two silences are deliberate. UNSOLD has no cue (C-23: rejection of a person
// gets neutral ink, no red, no sound). And ARRIVING at a moment is not the
// moment happening: the first snapshot a surface receives is swallowed, so a
// spectator opening the page mid-SOLD does not hear a gavel for a sale that
// happened before they got there.

const CUE_FOR: Partial<Record<CeremonyState["phase"], SoundCue>> = {
  opening: "opening",
  bid: "bid",
  extension: "extension",
  sold: "sold",
  completed: "complete",
};

/** The clock's one interruption: two ticks as the lot enters its last ten seconds. */
const WARNING_AT_SECONDS = 10;

export function useCeremonySound({
  ceremony,
  remainingMs,
  lotId,
}: {
  ceremony: CeremonyState;
  remainingMs: number | null;
  /** The lot on the block, so the warning sounds once per lot. */
  lotId: string | null;
}): void {
  const play = useSoundCue();
  const armedRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);
  const warnedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastKeyRef.current === ceremony.key) {
      return;
    }
    lastKeyRef.current = ceremony.key;
    if (!armedRef.current) {
      // The first real moment is where we came in, not something that happened.
      if (ceremony.phase !== "idle") {
        armedRef.current = true;
      }
      return;
    }
    if (ceremony.phase === "extension") {
      // The bid bought time: the ten-second warning is worth hearing again.
      warnedForRef.current = null;
    }
    const cue = CUE_FOR[ceremony.phase];
    if (cue !== undefined) {
      play(cue);
    }
  }, [ceremony, play]);

  useEffect(() => {
    if (lotId === null || remainingMs === null || !armedRef.current) {
      return;
    }
    const seconds = Math.ceil(remainingMs / 1000);
    if (seconds <= WARNING_AT_SECONDS && seconds > 0 && warnedForRef.current !== lotId) {
      warnedForRef.current = lotId;
      play("warning");
    }
  }, [lotId, remainingMs, play]);
}
