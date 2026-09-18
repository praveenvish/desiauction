"use client";

import { useState, type HTMLAttributes } from "react";

import styles from "./rolling-number.module.css";

export interface RollingNumberProps extends HTMLAttributes<HTMLSpanElement> {
  /** The pre-formatted figure ("₹1,20,000") — ui never computes money (C-7). */
  value: string;
}

const DIGIT = /^[0-9]$/;

/**
 * A figure whose digits ROLL when it changes.
 *
 * On a hall screen a bid that simply becomes another bid is a change you can
 * miss. Here every digit that differs from the previous render slides in from
 * below while the old one leaves upward — an odometer — and the digits that did
 * not change stay put, so ₹95,000 → ₹1,00,000 reads as the money moving, not
 * as the whole number blinking.
 *
 * Three constraints shaped it:
 * - `textContent` is exactly `value`. The outgoing digit is drawn by a
 *   `::before` pseudo-element (`content: attr(data-prev)`), which the DOM does
 *   not carry, so a test or a screen reader that reads the figure reads the
 *   figure and nothing else.
 * - Transform only. Nothing here changes opacity or colour, so the contrast
 *   scans that sample every animation frame read the same as at rest.
 * - No motion on first paint. The previous value starts equal to the current
 *   one, so a server-rendered figure hydrates still; only a CHANGE rolls.
 *
 * Digits are compared right-aligned, so a number that grows a place (a new
 * leading digit) rolls that digit in from nothing rather than re-rolling
 * every column. Under reduced motion the CSS drops the animation and the
 * figure jumps to its new value.
 */
export function RollingNumber({ value, className, ...rest }: RollingNumberProps) {
  // The value this figure rolled FROM, held until the next change. It used to
  // be a ref overwritten after every commit, so the first unrelated re-render
  // after a change saw prev === value, re-keyed every rolling digit as "still"
  // and remounted it — cutting the roll off mid-slide. State adjusted during
  // render (React's pattern for "previous prop") keeps it for the whole roll.
  const [pair, setPair] = useState({ value, prev: value });
  if (pair.value !== value) {
    setPair({ value, prev: pair.value });
  }
  const prev = pair.value === value ? pair.prev : pair.value;

  const aligned = prev.padStart(value.length, " ").slice(-value.length);
  return (
    <span className={[styles["number"], className].filter(Boolean).join(" ")} {...rest}>
      {Array.from(value).map((char, index) => {
        const before = aligned[index] ?? " ";
        const rolls = DIGIT.test(char) && before !== char;
        if (!rolls) {
          return (
            <span key={`${String(index)}-still`} className={styles["digit"]}>
              {char}
            </span>
          );
        }
        // Keyed on the value so a change remounts the column and the roll
        // replays; an unrelated re-render keeps the key and stays still.
        return (
          <span
            key={`${String(index)}-${value}`}
            className={`${styles["digit"] ?? ""} ${styles["roll"] ?? ""}`}
            data-prev={DIGIT.test(before) ? before : ""}
            data-testid="rolling-digit"
          >
            {char}
          </span>
        );
      })}
    </span>
  );
}
