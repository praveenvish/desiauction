import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button, ButtonLink, buttonClassName } from "./button";

const CSS = readFileSync(join(__dirname, "button.module.css"), "utf8");

/** The `min-height` a size rung declares — the value that becomes its height. */
function rungHeight(size: string): string | undefined {
  return new RegExp(`\\.${size}\\s*\\{([^}]*)\\}`)
    .exec(CSS)?.[1]
    ?.match(/min-height:\s*(\S+?);/)?.[1];
}

describe("Button", () => {
  it("is a real button with a safe default type", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("activates by keyboard", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("loading blocks interaction and announces busy", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Submit
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button).catch(() => undefined);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Button sizes", () => {
  /**
   * The 44px rung the platform's touch convention asks for. It has to resolve to
   * a REAL class: buttonClassName filters falsy tokens, so a renamed or deleted
   * `.touch` rule would not throw — it would quietly drop the size class and
   * hand back a button with no height floor at all.
   */
  it("touch is a distinct rung that resolves to a real class", () => {
    const touch = buttonClassName({ size: "touch" });
    expect(touch).not.toEqual(buttonClassName({ size: "md" }));
    // base + variant + size. A missing .touch rule collapses this to two.
    expect(touch.split(" ")).toHaveLength(3);
    expect(rungHeight("touch")).toBe("44px");
  });

  /**
   * `touch` was added as a FOURTH rung rather than as a new height for `md`
   * because `md` is the default and most call sites in the product take it
   * implicitly — raising it would have grown nearly every button by 4px to fix
   * the handful of surfaces that actually need 44. This pins that decision: if
   * someone later moves an existing rung, they do it deliberately, with this
   * test in the diff, rather than as a quiet side effect.
   */
  it("leaves the pre-existing rungs exactly where they were", () => {
    expect(rungHeight("sm")).toBe("32px");
    expect(rungHeight("md")).toBe("40px");
    expect(rungHeight("lg")).toBe("52px");
  });
});

describe("ButtonLink", () => {
  it("renders an anchor with button styling", () => {
    render(<ButtonLink href="/somewhere">Open</ButtonLink>);
    const link = screen.getByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("href", "/somewhere");
  });
});
