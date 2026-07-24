import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineSearch } from "./inline-search";
import type { PaletteGroup } from "./search-filter";

const GROUPS: PaletteGroup[] = [
  {
    label: "Go to",
    items: [
      { key: "home", label: "Home", href: "/home" },
      { key: "money", label: "Money", href: "/money" },
    ],
  },
  {
    label: "Seasons",
    items: [{ key: "mpl", label: "MPL 2026", hint: "Malad CC", href: "/seasons/mpl-2026" }],
  },
];

function open() {
  return screen.getByRole("button", { name: "Search (⌘K)" });
}

describe("InlineSearch", () => {
  it("rests as one icon and expands into a combobox", async () => {
    const user = userEvent.setup();
    render(<InlineSearch groups={GROUPS} onNavigate={() => {}} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(open());
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("filters items across label and hint", async () => {
    const user = userEvent.setup();
    render(<InlineSearch groups={GROUPS} onNavigate={() => {}} />);
    await user.click(open());
    await user.type(screen.getByRole("combobox"), "malad");
    expect(screen.getByText("MPL 2026")).toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  });

  it("navigates with Enter on the highlighted item and collapses", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<InlineSearch groups={GROUPS} onNavigate={onNavigate} />);
    await user.click(open());
    await user.type(screen.getByRole("combobox"), "money{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("/money");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the honest empty result", async () => {
    const user = userEvent.setup();
    render(<InlineSearch groups={GROUPS} onNavigate={() => {}} />);
    await user.click(open());
    await user.type(screen.getByRole("combobox"), "zzz");
    expect(screen.getByText("Nothing matches — try a shorter word.")).toBeInTheDocument();
  });

  it("Escape collapses and returns focus to the icon", async () => {
    const user = userEvent.setup();
    render(<InlineSearch groups={GROUPS} onNavigate={() => {}} />);
    await user.click(open());
    await user.keyboard("{Escape}");
    expect(open()).toHaveFocus();
  });
});
