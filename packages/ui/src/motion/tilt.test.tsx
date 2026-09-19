import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tilt } from "./tilt";

function mockMedia(matches: Record<string, boolean>) {
  const fake = (query: string): MediaQueryList =>
    ({
      matches: matches[query] ?? false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", fake);
}

describe("Tilt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("engages on a fine pointer and writes the angle as custom properties", () => {
    mockMedia({ "(pointer: fine)": true, "(prefers-reduced-motion: reduce)": false });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    render(
      <Tilt data-testid="tilt" max={10}>
        face
      </Tilt>,
    );
    const el = screen.getByTestId("tilt");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    } as DOMRect);
    // Bottom-right corner: x = +1, y = +1 → rotateY +10, rotateX -10.
    fireEvent.pointerMove(el, { clientX: 200, clientY: 100 });
    expect(el.dataset["active"]).toBe("true");
    expect(el.style.getPropertyValue("--tilt-y")).toBe("10.00deg");
    expect(el.style.getPropertyValue("--tilt-x")).toBe("-10.00deg");
    fireEvent.pointerLeave(el);
    expect(el.dataset["active"]).toBeUndefined();
    expect(el.style.getPropertyValue("--tilt-y")).toBe("0deg");
  });

  it("never engages on a coarse pointer or under reduced motion", () => {
    mockMedia({ "(pointer: fine)": false });
    render(<Tilt data-testid="tilt">face</Tilt>);
    const el = screen.getByTestId("tilt");
    fireEvent.pointerMove(el, { clientX: 10, clientY: 10 });
    expect(el.dataset["active"]).toBeUndefined();
    expect(el.style.getPropertyValue("--tilt-y")).toBe("");

    mockMedia({ "(pointer: fine)": true, "(prefers-reduced-motion: reduce)": true });
    fireEvent.pointerMove(el, { clientX: 10, clientY: 10 });
    expect(el.dataset["active"]).toBeUndefined();
  });
});
