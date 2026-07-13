import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnnouncerProvider, useAnnouncer, type Announce } from "./announcer";

function Capture({ onReady }: { onReady: (announce: Announce) => void }) {
  const announce = useAnnouncer();
  useEffect(() => {
    onReady(announce);
  }, [announce, onReady]);
  return null;
}

function renderAnnouncer(): Announce {
  let fire: Announce = () => undefined;
  render(
    <AnnouncerProvider>
      <Capture
        onReady={(a) => {
          fire = a;
        }}
      />
    </AnnouncerProvider>,
  );
  return (message, channel) => {
    act(() => {
      fire(message, channel);
    });
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Announcer", () => {
  it("mounts both live regions permanently, empty by default", () => {
    renderAnnouncer();
    expect(screen.getByTestId("announcer-polite")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("announcer-assertive")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByTestId("announcer-polite")).toBeEmptyDOMElement();
  });

  it("serializes polite announcements through the queue in order", () => {
    vi.useFakeTimers();
    const fire = renderAnnouncer();
    fire("Bid placed");
    fire("You lead");
    const polite = screen.getByTestId("announcer-polite");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(polite).toHaveTextContent("Bid placed");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(polite).toHaveTextContent("You lead");
  });

  it("assertive messages land immediately, bypassing the queue", () => {
    const fire = renderAnnouncer();
    fire("Purse exhausted", "assertive");
    expect(screen.getByTestId("announcer-assertive")).toHaveTextContent("Purse exhausted");
  });

  it("repeated identical messages are re-announced (clear-then-set)", () => {
    vi.useFakeTimers();
    const fire = renderAnnouncer();
    fire("Sold");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent("Sold");
    fire("Sold");
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByTestId("announcer-polite")).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent("Sold");
  });
});
