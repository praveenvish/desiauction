import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SoldStamp } from "./sold-stamp";

describe("SoldStamp", () => {
  it("SOLD is gold, struck by the gavel, and announces the word", () => {
    const { container } = render(<SoldStamp />);
    const stamp = screen.getByTestId("stamp");
    expect(stamp).toHaveAttribute("data-tone", "sold");
    expect(stamp).toHaveTextContent("SOLD");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("UNSOLD carries no hammer even when asked for one (C-23: dignified brevity)", () => {
    const { container } = render(<SoldStamp tone="unsold" hammer />);
    expect(screen.getByTestId("stamp")).toHaveTextContent("UNSOLD");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("takes a custom word for the champion moment", () => {
    render(<SoldStamp label="CHAMPIONS" hammer={false} />);
    expect(screen.getByTestId("stamp")).toHaveTextContent("CHAMPIONS");
  });
});
