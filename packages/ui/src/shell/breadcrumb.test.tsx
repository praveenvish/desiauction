import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Breadcrumb } from "./breadcrumb";

describe("Breadcrumb", () => {
  it("links ancestors and marks the last item as the current page", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Malad CC", href: "/org/malad-cc" },
          { label: "MPL 2026", href: "/competitions/mpl-2026" },
          { label: "Registrations" },
        ]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Malad CC" })).toHaveAttribute("href", "/org/malad-cc");
    const current = screen.getByText("Registrations");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).toBe("SPAN");
  });

  it("truncates beyond canon depth 3", () => {
    render(
      <Breadcrumb
        items={[
          { label: "A", href: "/a" },
          { label: "B", href: "/b" },
          { label: "C", href: "/c" },
          { label: "D" },
        ]}
      />,
    );
    expect(screen.queryByText("D")).not.toBeInTheDocument();
    expect(screen.getByText("C")).toHaveAttribute("aria-current", "page");
  });
});
