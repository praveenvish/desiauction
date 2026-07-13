import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Tabs } from "./tabs";

const TABS = [
  { id: "squads", label: "Squads", content: <p>Squad list</p> },
  { id: "pool", label: "Pool", content: <p>Player pool</p> },
  { id: "purse", label: "Purse", content: <p>Purse table</p> },
];

describe("Tabs", () => {
  it("renders the WAI-ARIA pattern with one selected tab", () => {
    render(<Tabs tabs={TABS} label="Auction sections" />);
    expect(screen.getByRole("tablist", { name: "Auction sections" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Squads" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Squad list");
  });

  it("arrow keys move selection and focus, wrapping", async () => {
    render(<Tabs tabs={TABS} label="Sections" />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Pool" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Player pool");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Purse" })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Squads" })).toHaveFocus();
  });

  it("only the active tab is in the tab order (roving tabindex)", () => {
    render(<Tabs tabs={TABS} label="Sections" />);
    expect(screen.getByRole("tab", { name: "Squads" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Pool" })).toHaveAttribute("tabindex", "-1");
  });
});
