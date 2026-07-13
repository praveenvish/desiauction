import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Money } from "../primitives/money";
import { PlayerCard } from "./player-card";

describe("PlayerCard", () => {
  it("composes identity, role, captaincy, status and detail", () => {
    render(
      <PlayerCard
        name="Rohit Sharma"
        seed="p1"
        role="batter"
        captain
        status="sold"
        detail="Sunrisers Malad"
        trailing={<Money>₹8,25,000</Money>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Rohit Sharma" })).toBeInTheDocument();
    expect(screen.getByLabelText("Captain")).toBeInTheDocument();
    expect(screen.getByLabelText("batter")).toHaveTextContent("BAT");
    expect(screen.getByText("Sold")).toBeInTheDocument();
    expect(screen.getByText("Sunrisers Malad")).toBeInTheDocument();
    expect(screen.getByText("₹8,25,000")).toBeInTheDocument();
  });

  it("keeps 'passed' dignified — a neutral fact, never an error (C-23)", () => {
    render(<PlayerCard name="Kiran Patel" seed="p2" status="passed" />);
    const badge = screen.getByText("Passes");
    expect(badge.className).not.toContain("danger");
  });

  it("renders long names without truncation", () => {
    const long = "Yashasvi Bhupendra Kumar Jaiswal-Deshmukh";
    render(<PlayerCard name={long} seed="p3" />);
    expect(screen.getByRole("heading", { name: long })).toBeInTheDocument();
  });
});
