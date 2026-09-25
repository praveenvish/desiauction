import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast, type ToastOptions } from "./toast";

type FireFn = (options: ToastOptions) => void;

function Capture({ onReady }: { onReady: (fire: FireFn) => void }) {
  const toast = useToast();
  useEffect(() => {
    onReady(toast);
  }, [toast, onReady]);
  return null;
}

function renderToaster(): FireFn {
  let fire: FireFn = () => undefined;
  render(
    <ToastProvider>
      <Capture
        onReady={(f) => {
          fire = f;
        }}
      />
    </ToastProvider>,
  );
  return (options) => {
    act(() => {
      fire(options);
    });
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("announces via a polite status region", () => {
    const fire = renderToaster();
    fire({ title: "Player saved", duration: 0 });
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("Player saved");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("auto-dismisses on its timer", () => {
    vi.useFakeTimers();
    const fire = renderToaster();
    fire({ title: "Going", duration: 1000 });
    expect(screen.getByRole("status")).toHaveTextContent("Going");
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("Going");
  });

  it("dismisses by button", () => {
    const fire = renderToaster();
    fire({ title: "Sticky", duration: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: Sticky" }));
    expect(screen.getByRole("status")).not.toHaveTextContent("Sticky");
  });

  it("caps the stack at three", () => {
    const fire = renderToaster();
    for (let i = 1; i <= 5; i++) {
      fire({ title: `T${String(i)}`, duration: 0 });
    }
    expect(screen.getAllByRole("button", { name: /Dismiss/ })).toHaveLength(3);
    expect(screen.getByRole("status")).not.toHaveTextContent("T1");
    expect(screen.getByRole("status")).toHaveTextContent("T5");
  });

  it("a toast in a group replaces the last one in that group instead of stacking", () => {
    const fire = renderToaster();
    fire({ title: "Saved" });
    fire({ title: "Outbid at 1,500", group: "bid-status" });
    fire({ title: "Outbid at 2,500", group: "bid-status" });
    expect(screen.queryByText("Outbid at 1,500")).toBeNull();
    expect(screen.getByText("Outbid at 2,500")).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
  });
});
