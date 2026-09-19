"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";

import styles from "./tilt.module.css";

export interface TiltProps extends HTMLAttributes<HTMLDivElement> {
  /** Maximum rotation in degrees. Defaults to the `--depth-tilt` token (6deg). */
  max?: number;
  /** Adds the sheen that follows the pointer across the face. */
  glare?: boolean;
  /** Also lifts the element by `--depth-lift` while the pointer is on it. */
  lift?: boolean;
}

/**
 * Pointer-tracked depth: the element turns a few degrees toward the cursor and
 * settles back when it leaves. The premium feel comes from restraint — the
 * default 6deg is the most a card can turn before its text starts to skew.
 *
 * Three rules keep it honest:
 * - Transform only. Nothing here changes layout, opacity or color, so the
 *   contrast scans that sample every frame read the same as at rest.
 * - Fine pointers only. A touch has no hover; a card that tilts on tap-down
 *   is a jitter, so the listener never engages when `(pointer: fine)` is
 *   false or reduced motion is on. The CSS side flattens it as well, so the
 *   two gates cannot disagree.
 * - No per-move React state. The angle is written straight to custom
 *   properties inside a single animation frame; React never re-renders on
 *   pointer movement.
 */
export const Tilt = forwardRef<HTMLDivElement, TiltProps>(function Tilt(
  { max, glare = false, lift = false, className, style, children, onPointerMove, ...rest },
  forwardedRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLDivElement);
  const frame = useRef<number | null>(null);
  const engaged = useRef(false);

  const canTilt = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: fine)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const write = useCallback(
    (x: number, y: number, gx: number, gy: number) => {
      const el = ref.current;
      if (el === null) return;
      const token = Number.parseFloat(getComputedStyle(el).getPropertyValue("--depth-tilt"));
      const limit = max ?? (Number.isFinite(token) && token > 0 ? token : 6);
      el.style.setProperty("--tilt-x", `${(-y * limit).toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${(x * limit).toFixed(2)}deg`);
      el.style.setProperty("--glare-x", `${gx.toFixed(1)}%`);
      el.style.setProperty("--glare-y", `${gy.toFixed(1)}%`);
    },
    [max],
  );

  const handleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    if (!engaged.current) {
      if (!canTilt()) return;
      engaged.current = true;
      ref.current?.setAttribute("data-active", "true");
    }
    const el = ref.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    // -1..1 from the centre, so the corner nearest the pointer comes forward.
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    const gx = ((event.clientX - rect.left) / rect.width) * 100;
    const gy = ((event.clientY - rect.top) / rect.height) * 100;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      write(x, y, gx, gy);
    });
  };

  const handleLeave = () => {
    if (!engaged.current) return;
    engaged.current = false;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const el = ref.current;
    if (el === null) return;
    el.removeAttribute("data-active");
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  };

  return (
    <div
      ref={ref}
      className={[styles["tilt"], lift ? styles["lift"] : undefined, className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onPointerCancel={handleLeave}
      {...rest}
    >
      {children}
      {glare ? <span className={styles["glare"]} aria-hidden="true" /> : null}
    </div>
  );
});
