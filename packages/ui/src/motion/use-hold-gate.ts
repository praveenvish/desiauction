"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface HoldGateOptions {
  /** Real elapsed milliseconds required before the gate opens. */
  durationMs: number;
  /** Fired exactly once when the hold completes. */
  onConfirm: () => void;
  disabled?: boolean;
  /**
   * WHAT the hold is confirming. When it changes while a hold is in progress
   * the hold ABORTS — no fire, progress back to zero — and has to be started
   * again from nothing (a pointer press or a fresh key press; a held key's
   * auto-repeat never restarts it). The gavel keys it on the lot, the leader
   * and the amount, so a conductor who began selling to one team can never
   * end up selling to another. A change while idle does nothing.
   */
  resetKey?: string;
  /** Called once each time a `resetKey` change aborts a hold in progress. */
  onReset?: () => void;
}

export interface HoldGateBind {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onKeyDown: (event: { key: string; repeat: boolean }) => void;
  onKeyUp: (event: { key: string }) => void;
  onBlur: () => void;
}

export interface HoldGate {
  /** True while the user is holding. */
  holding: boolean;
  /** 0..1 visual progress — presentation only, never the gate itself. */
  progress: number;
  bind: HoldGateBind;
}

/**
 * The F-AX-1 safety rule made structural (IP-1_DESIGN §8): confirmation
 * requires REAL ELAPSED TIME measured by a clock, not an animation. Reduced
 * motion changes the presentation of progress, never the duration. Releasing,
 * leaving, cancelling or blurring before the threshold aborts harmlessly.
 */
export function useHoldGate({
  durationMs,
  onConfirm,
  disabled = false,
  resetKey = "",
  onReset,
}: HoldGateOptions): HoldGate {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<number | null>(null);
  /** The `resetKey` the hold in progress was started under. */
  const startedKey = useRef(resetKey);
  const frame = useRef<number>(0);
  // Written during render, together: the confirm the gate would fire and the
  // key it would fire under always come from the same render.
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;
  const keyRef = useRef(resetKey);
  keyRef.current = resetKey;
  const resetRef = useRef(onReset);
  resetRef.current = onReset;

  const stop = useCallback(() => {
    startedAt.current = null;
    cancelAnimationFrame(frame.current);
    setHolding(false);
    setProgress(0);
  }, []);

  /** The thing being confirmed changed under the hold: abort, and say so once. */
  const abort = useCallback(() => {
    if (startedAt.current === null) {
      return;
    }
    stop();
    resetRef.current?.();
  }, [stop]);

  const tick = useCallback(() => {
    if (startedAt.current === null) {
      return;
    }
    // Belt and braces with the layout effect below: a frame that lands after
    // a render with a new key but before its commit must not fire the NEW
    // confirm on the strength of a hold begun under the old key.
    if (keyRef.current !== startedKey.current) {
      abort();
      return;
    }
    const elapsed = performance.now() - startedAt.current;
    if (elapsed >= durationMs) {
      stop();
      confirmRef.current();
      return;
    }
    setProgress(elapsed / durationMs);
    frame.current = requestAnimationFrame(tick);
  }, [abort, durationMs, stop]);

  /**
   * The press ENDED (pointer up, key up) — as opposed to being abandoned
   * (leave, cancel, blur), which always stops. The hold is judged on the
   * clock, not on how many frames happened to land: a busy device that drew
   * no frame in the last stretch of a full hold must still confirm on
   * release, or a 900ms hold under load closes nothing (the WebKit nightly's
   * multi-window auction specs, every night). A short press still stops.
   */
  const release = useCallback(() => {
    const begun = startedAt.current;
    if (begun === null) {
      return;
    }
    if (keyRef.current !== startedKey.current) {
      abort();
      return;
    }
    const held = performance.now() - begun >= durationMs;
    stop();
    if (held) {
      confirmRef.current();
    }
  }, [abort, durationMs, stop]);

  const start = useCallback(() => {
    if (disabled || startedAt.current !== null) {
      return;
    }
    startedAt.current = performance.now();
    startedKey.current = keyRef.current;
    setHolding(true);
    setProgress(0);
    frame.current = requestAnimationFrame(tick);
  }, [disabled, tick]);

  // A layout effect, so the abort lands in the same commit that shows the new
  // key (the new leader on the label) — before the browser paints a fill
  // that belongs to the old one.
  useLayoutEffect(() => {
    if (startedAt.current !== null && startedKey.current !== resetKey) {
      abort();
    }
  }, [abort, resetKey]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(frame.current);
    };
  }, []);

  return {
    holding,
    progress,
    bind: {
      onPointerDown: start,
      onPointerUp: release,
      onPointerLeave: stop,
      onPointerCancel: stop,
      onBlur: stop,
      onKeyDown: (event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          start();
        }
      },
      onKeyUp: (event) => {
        if (event.key === " " || event.key === "Enter") {
          release();
        }
      },
    },
  };
}
