"use client";

import { useEffect, useState } from "react";

import { RollingNumber } from "../theatre/rolling-number";

/**
 * A KPI figure that counts in. The server paints the real value (so the first
 * frame, a test and a screen reader all read the truth); once hydrated it
 * spends one frame on zeros and then rolls every digit up through the
 * odometer. Later changes roll only the digits that moved. Under reduced
 * motion it never leaves the value.
 */
export function KitFigure({ value }: { value: string }) {
  // Non-null only for the one frame the figure sits on its zeros.
  const [zeros, setZeros] = useState<string | null>(null);
  useEffect(() => {
    const still =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || !/[1-9]/.test(value)) {
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      setZeros(value.replace(/[0-9]/g, "0"));
      second = requestAnimationFrame(() => {
        setZeros(null);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    // Once, on arrival; later values roll through RollingNumber itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <RollingNumber value={zeros ?? value} />;
}
