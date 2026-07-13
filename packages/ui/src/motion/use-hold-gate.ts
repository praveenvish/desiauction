"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface HoldGateOptions {
  /** Real elapsed milliseconds required before the gate opens. */
  durationMs: number;
  /** Fired exactly once when the hold completes. */
  onConfirm: () => void;
  disabled?: boolean;
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
}: HoldGateOptions): HoldGate {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<number | null>(null);
  const frame = useRef<number>(0);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  const stop = useCallback(() => {
    startedAt.current = null;
    cancelAnimationFrame(frame.current);
    setHolding(false);
    setProgress(0);
  }, []);

  const tick = useCallback(() => {
    if (startedAt.current === null) {
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
  }, [durationMs, stop]);

  const start = useCallback(() => {
    if (disabled || startedAt.current !== null) {
      return;
    }
    startedAt.current = performance.now();
    setHolding(true);
    setProgress(0);
    frame.current = requestAnimationFrame(tick);
  }, [disabled, tick]);

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
      onPointerUp: stop,
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
          stop();
        }
      },
    },
  };
}
