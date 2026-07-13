import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHoldGate } from "./use-hold-gate";

function HoldButton({
  onConfirm,
  disabled = false,
}: {
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const gate = useHoldGate({ durationMs: 1000, onConfirm, disabled });
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
});
