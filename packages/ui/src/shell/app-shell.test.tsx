import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  /**
   * The brand link had no accessible name under 720px: the top bar's copy of
   * the wordmark hid its text with `display: none` — which removes it from the
   * accessibility tree, not just from view — while the glyph beside it is
   * aria-hidden because it is decorative. A link in the tab order, named
   * nothing (axe `link-name`, serious, on every authenticated page).
   *
   * Two halves, so two tests. This one holds the markup: the words must stay in
   * the DOM and unhidden, and the mark must stay decorative — "fixing" this by
   * giving the glyph a label would name the link after the logo instead of
   * after where it goes.
   */
  it("names both brand links by the wordmark, with the mark kept decorative", () => {
    const { container } = render(
      <AppShell nav={NAV} wordmark="DesiAuction" wordmarkHref="/home" tagline="Bid · Build · Win">
        <p>x</p>
      </AppShell>,
    );
    // Two copies by design — the rail's (≥720px) and the top bar's (<720px).
    const brand = screen.getAllByRole("link", { name: /DesiAuction/ });
    expect(brand).toHaveLength(2);
    for (const link of brand) {
      expect(link).toHaveAttribute("href", "/home");
    }
    // The glyph carries no name of its own, in either copy.
    const glyphs = container.querySelectorAll("[aria-hidden]");
    expect(glyphs.length).toBeGreaterThanOrEqual(2);
    for (const glyph of glyphs) {
      expect(glyph.getAttribute("aria-label")).toBeNull();
    }
  });

  /**
   * The other half lives in CSS and no amount of jsdom will see it: the
   * stylesheet decides whether those words reach the accessibility tree. This
   * is the same shape of guard as `guardrails.test.ts` — read the rule, assert
   * the property — and it is the one that would have caught the original bug,
   * because the markup was never wrong.
   */
  it("hides the top bar's wordmark by clipping it, never by removing it", () => {
    const css = readFileSync(join(__dirname, "app-shell.module.css"), "utf8");
    const rule = /\.topbar-brand \.wordmark-text \{([^}]*)\}/.exec(css);
    expect(rule, ".topbar-brand .wordmark-text rule not found").not.toBeNull();
    const body = rule?.[1] ?? "";
    // `display: none` and `visibility: hidden` both take the words out of the
    // accessibility tree; the clip pattern takes only the pixels.
    expect(body).not.toMatch(/display:\s*none/);
    expect(body).not.toMatch(/visibility:\s*hidden/);
    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
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
