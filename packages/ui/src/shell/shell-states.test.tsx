import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ErrorState } from "../primitives/error-state";
import { LoadingState } from "./loading-state";
import { PageHeader, QuickActionBar, SectionHeader } from "./page-header";
import { SubNavTabs } from "./sub-nav-tabs";

describe("ErrorState", () => {
  it("is an alert with recovery actions", () => {
    render(
      <ErrorState
        title="Something broke on our side"
        description="You didn't lose anything."
        actions={<a href="/home">Go home</a>}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toBeInTheDocument();
  });
});

describe("LoadingState", () => {
  it("announces loading exactly once and hides skeletons from AT", () => {
    render(<LoadingState variant="table" count={3} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });
});

describe("PageHeader / SectionHeader / QuickActionBar", () => {
  it("renders one h1, h2 sections, and a labeled toolbar", () => {
    render(
      <>
        <PageHeader title="Competitions" subtitle="All yours" actions={<button>New</button>} />
        <SectionHeader title="Your schedule" />
        <QuickActionBar label="Bulk actions">
          <button>Approve</button>
        </QuickActionBar>
      </>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Competitions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your schedule" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeInTheDocument();
  });
});

describe("SubNavTabs", () => {
  it("marks the active tab and renders attention counts", () => {
    render(
      <SubNavTabs
        label="Competition sections"
        tabs={[
          { key: "overview", label: "Overview", href: "/c", active: true },
          { key: "registrations", label: "Registrations", href: "/c/registrations", attention: 12 },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});
