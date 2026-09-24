import { render, screen } from "@testing-library/react";
import { forwardRef, type AnchorHTMLAttributes } from "react";
import { describe, expect, it } from "vitest";

import { PopoverMenu } from "../shell/popover-menu";
import { ButtonLink } from "./button";
import { LinkComponentProvider, isRouterHref } from "./link-context";

const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
  function RouterLink(props, ref) {
    return (
      <a ref={ref} data-router="" {...props}>
        {props.children}
      </a>
    );
  },
);

describe("isRouterHref", () => {
  it.each(["/home", "/seasons/x/teams?view=a", "/org/demo#money", "/seasons/x/posters"])(
    "routes the in-app page %s",
    (href) => {
      expect(isRouterHref(href)).toBe(true);
    },
  );

  it.each([
    undefined,
    "https://example.com",
    "//evil.example",
    "mailto:a@b.c",
    "#main",
    "/api/media/upload",
    "/reports/export?season=x",
    "/demo/abc/invite.ics",
    "/seasons/x/posters/player/42",
    "/admin/reports/r1/screenshot",
  ])("leaves %s to the browser", (href) => {
    expect(isRouterHref(href)).toBe(false);
  });

  it("leaves downloads and new tabs to the browser", () => {
    expect(isRouterHref("/home", { download: "" })).toBe(false);
    expect(isRouterHref("/home", { target: "_blank" })).toBe(false);
    expect(isRouterHref("/home", { target: "_self" })).toBe(true);
  });
});

describe("ButtonLink / PopoverMenu with a provided router link", () => {
  it("renders an in-app ButtonLink through the router link", () => {
    render(
      <LinkComponentProvider component={RouterLink}>
        <ButtonLink href="/home">Home</ButtonLink>
        <ButtonLink href="https://example.com">Out</ButtonLink>
      </LinkComponentProvider>,
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("data-router");
    expect(screen.getByRole("link", { name: "Out" })).not.toHaveAttribute("data-router");
  });

  it("is a plain anchor with no provider", () => {
    render(<ButtonLink href="/home">Home</ButtonLink>);
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("data-router");
  });

  it("routes a popover menu item", async () => {
    render(
      <LinkComponentProvider component={RouterLink}>
        <PopoverMenu
          label="More"
          trigger="More"
          items={[{ key: "a", label: "Teams", href: "/teams" }]}
        />
      </LinkComponentProvider>,
    );
    screen.getByRole("button", { name: "More" }).click();
    expect(await screen.findByRole("menuitem", { name: "Teams" })).toHaveAttribute("data-router");
  });
});
