import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHoldGate } from "./use-hold-gate";

function HoldButton({
  onConfirm,
  disabled = false,
  resetKey,
  onReset,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  resetKey?: string;
  onReset?: () => void;
}) {
  const gate = useHoldGate({
    durationMs: 1000,
    onConfirm,
    disabled,
    ...(resetKey === undefined ? {} : { resetKey }),
    ...(onReset === undefined ? {} : { onReset }),
  });
  return (
    <button type="button" data-holding={gate.holding} data-progress={gate.progress} {...gate.bind}>
      Hold to confirm
    </button>
  );
}

// rAF doesn't advance under fake timers; drive it manually off the fake clock.
beforeEach(() => {
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    return setTimeout(() => {
      now += 50;
      cb(now);
    }, 50) as unknown as number;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    clearTimeout(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useHoldGate", () => {
  it("confirms only after the full duration of real held time", () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("data-holding", "true");
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("data-holding", "false");
  });

  // The harness holds for 1000ms (HoldButton above).
  describe("frames starved — a busy device draws nothing during the hold", () => {
    let clock = 0;
    beforeEach(() => {
      clock = 0;
      vi.spyOn(performance, "now").mockImplementation(() => clock);
      vi.stubGlobal("requestAnimationFrame", () => 0);
    });

    it("a full hold confirms on release, judged by the clock", () => {
      const onConfirm = vi.fn();
      render(<HoldButton onConfirm={onConfirm} />);
      const button = screen.getByRole("button");
      fireEvent.pointerDown(button);
      clock = 1200;
      fireEvent.pointerUp(button);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(button).toHaveAttribute("data-holding", "false");
    });

    it("a short press released early still does nothing", () => {
      const onConfirm = vi.fn();
      render(<HoldButton onConfirm={onConfirm} />);
      const button = screen.getByRole("button");
      fireEvent.pointerDown(button);
      clock = 300;
      fireEvent.pointerUp(button);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("leaving the button never confirms, however long it was held", () => {
      const onConfirm = vi.fn();
      render(<HoldButton onConfirm={onConfirm} />);
      const button = screen.getByRole("button");
      fireEvent.pointerDown(button);
      clock = 1200;
      fireEvent.pointerLeave(button);
      fireEvent.pointerUp(button);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("a full keyboard hold confirms on key release", () => {
      const onConfirm = vi.fn();
      render(<HoldButton onConfirm={onConfirm} />);
      const button = screen.getByRole("button");
      fireEvent.keyDown(button, { key: " " });
      clock = 1100;
      fireEvent.keyUp(button, { key: " " });
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it("an early release aborts harmlessly and resets progress", () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(button);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("data-progress", "0");
  });

  it("pointer leaving mid-hold cancels (no accidental gavel)", () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerLeave(button);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keyboard Space hold works; key repeat does not restart the clock", () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} />);
    const button = screen.getByRole("button");
    fireEvent.keyDown(button, { key: " ", repeat: false });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    fireEvent.keyDown(button, { key: " ", repeat: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keyboard release before the threshold aborts", () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} />);
    const button = screen.getByRole("button");
    fireEvent.keyDown(button, { key: "Enter", repeat: false });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.keyUp(button, { key: "Enter" });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} disabled />);
    fireEvent.pointerDown(screen.getByRole("button"));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  describe("resetKey — what is being confirmed changed under the hold", () => {
    it("a key change mid-hold aborts: no fire, fill back to zero, onReset once", () => {
      const onConfirm = vi.fn();
      const onReset = vi.fn();
      const { rerender } = render(
        <HoldButton onConfirm={onConfirm} resetKey="lot1:P1:100" onReset={onReset} />,
      );
      const button = screen.getByRole("button");
      fireEvent.pointerDown(button);
      act(() => {
        vi.advanceTimersByTime(600);
      });
      rerender(<HoldButton onConfirm={onConfirm} resetKey="lot1:P2:110" onReset={onReset} />);
      expect(button).toHaveAttribute("data-holding", "false");
      expect(button).toHaveAttribute("data-progress", "0");
      expect(onReset).toHaveBeenCalledTimes(1);
      // The pointer is STILL down: time passing must not fire it.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onReset).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(button);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("a key change while idle does nothing", () => {
      const onConfirm = vi.fn();
      const onReset = vi.fn();
      const { rerender } = render(
        <HoldButton onConfirm={onConfirm} resetKey="lot1:none:100" onReset={onReset} />,
      );
      rerender(<HoldButton onConfirm={onConfirm} resetKey="lot1:P1:100" onReset={onReset} />);
      rerender(<HoldButton onConfirm={onConfirm} resetKey="lot1:P2:110" onReset={onReset} />);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(onReset).not.toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
      // …and a hold begun under the new key fires as normal.
      const button = screen.getByRole("button");
      fireEvent.pointerDown(button);
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("after an abort, a fresh full hold fires exactly once — the new confirm", () => {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = render(<HoldButton onConfirm={first} resetKey="lot1:P1:100" />);
      const button = screen.getByRole("button");
      fireEvent.pointerDown(button);
      act(() => {
        vi.advanceTimersByTime(900);
      });
      rerender(<HoldButton onConfirm={second} resetKey="lot1:P2:110" />);
      fireEvent.pointerUp(button);
      // A fresh press starts the clock from zero: 900ms is not enough.
      fireEvent.pointerDown(button);
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(second).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("an unchanged key (a re-render mid-hold) fires once, as before", () => {
      const onConfirm = vi.fn();
      const onReset = vi.fn();
      const { rerender } = render(
        <HoldButton onConfirm={onConfirm} resetKey="lot1:P1:100" onReset={onReset} />,
      );
      const button = screen.getByRole("button");
      fireEvent.pointerDown(button);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      rerender(<HoldButton onConfirm={onConfirm} resetKey="lot1:P1:100" onReset={onReset} />);
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onReset).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("keyboard: a key change aborts a Space hold; auto-repeat cannot restart it; a fresh press can", () => {
      const onConfirm = vi.fn();
      const onReset = vi.fn();
      const { rerender } = render(
        <HoldButton onConfirm={onConfirm} resetKey="lot1:none:100" onReset={onReset} />,
      );
      const button = screen.getByRole("button");
      fireEvent.keyDown(button, { key: " ", repeat: false });
      act(() => {
        vi.advanceTimersByTime(700);
      });
      rerender(<HoldButton onConfirm={onConfirm} resetKey="lot1:P1:100" onReset={onReset} />);
      expect(onReset).toHaveBeenCalledTimes(1);
      // The key is still down; the OS keeps auto-repeating it.
      fireEvent.keyDown(button, { key: " ", repeat: true });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      fireEvent.keyDown(button, { key: " ", repeat: true });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(button).toHaveAttribute("data-holding", "false");
      fireEvent.keyUp(button, { key: " " });
      // Press again, hold the full time: it fires once.
      fireEvent.keyDown(button, { key: " ", repeat: false });
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });
});
