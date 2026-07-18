import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette, type PaletteGroup } from "./command-palette";

const GROUPS: PaletteGroup[] = [
  {
    label: "Go to",
    items: [
      { key: "home", label: "Home", href: "/home" },
      { key: "money", label: "Money", href: "/money" },
    ],
  },
  {
    label: "Competitions",
    items: [{ key: "mpl", label: "MPL 2026", hint: "Malad CC", href: "/competitions/mpl-2026" }],
  },
];

describe("CommandPalette", () => {
  it("filters items across label and hint", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} groups={GROUPS} onNavigate={() => {}} />);
    await user.type(screen.getByRole("combobox"), "malad");
    expect(screen.getByText("MPL 2026")).toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  });

  it("navigates with Enter on the highlighted item and closes", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} groups={GROUPS} onNavigate={onNavigate} />);
    await user.type(screen.getByRole("combobox"), "money{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("/money");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the honest empty result", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} groups={GROUPS} onNavigate={() => {}} />);
    await user.type(screen.getByRole("combobox"), "zzz");
    expect(screen.getByText("Nothing matches — try a shorter word.")).toBeInTheDocument();
  });
});
