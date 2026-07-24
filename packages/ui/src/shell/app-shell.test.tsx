import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell, type ShellNavItem } from "./app-shell";

const NAV: ShellNavItem[] = [
  { key: "home", label: "Home", href: "/home", active: true },
  { key: "competitions", label: "Competitions", href: "/competitions" },
  { key: "orgs", label: "Organizations", href: "/orgs" },
  { key: "money", label: "Money", href: "/money" },
  { key: "help", label: "Help", href: "/help" },
];

describe("AppShell", () => {
  it("renders skip link, rail + bottom tabs from one nav model, and content", () => {
    render(
      <AppShell nav={NAV} wordmark="DesiAuction">
        <h1>Content</h1>
      </AppShell>,
    );
    expect(screen.getByText("Skip to content")).toHaveAttribute("href", "#main-content");
    // One nav model renders twice (rail + bottom tabs); labels appear in both.
    expect(screen.getAllByText("Competitions")).toHaveLength(2);
    // Pages own <main>; the shell provides the skip target container.
    expect(document.getElementById("main-content")).toContainElement(screen.getByText("Content"));
  });

  it("marks the active item with aria-current in both navs", () => {
    render(
      <AppShell nav={NAV} wordmark="DesiAuction">
        <p>x</p>
      </AppShell>,
    );
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(2);
    for (const link of current) {
      expect(link).toHaveAttribute("href", "/home");
    }
  });

  it("owns the page's one h1, with the trail above it and tabs below", () => {
    render(
      <AppShell
        nav={NAV}
        wordmark="DesiAuction"
        breadcrumb={<nav aria-label="Breadcrumb">Malad CC</nav>}
        pageTitle="Auction"
        pageTitleAttrs={{ "data-testid": "shell-title" }}
        titleStatus={<span>LIVE</span>}
        tabs={<nav aria-label="Season sections">Overview</nav>}
      >
        <p>Content</p>
      </AppShell>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Auction" });
    expect(heading).toHaveAttribute("data-testid", "shell-title");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Season sections" })).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("injects the link component", () => {
    const Fake = ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
      <a data-injected href={href} {...rest}>
        {children}
      </a>
    );
    render(
      <AppShell nav={NAV.slice(0, 1)} wordmark="DA" linkComponent={Fake}>
        <p>x</p>
      </AppShell>,
    );
    expect(document.querySelectorAll("[data-injected]").length).toBeGreaterThan(0);
  });
});
