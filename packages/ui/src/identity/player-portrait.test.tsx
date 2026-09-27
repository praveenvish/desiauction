import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerPortrait } from "./player-portrait";

describe("PlayerPortrait", () => {
  it("draws the gold identity card when there is no photo — never a silhouette", () => {
    render(<PlayerPortrait name="Deepak Kadam" seed="reg-1" />);
    const frame = screen.getByTestId("player-portrait");
    expect(frame).toHaveAttribute("data-state", "identity");
    expect(screen.getByRole("img", { name: "Deepak Kadam" })).toBeInTheDocument();
    expect(screen.getByTestId("portrait-initials")).toHaveTextContent("DK");
    expect(frame.querySelector("img")).toBeNull();
  });

  it("keeps the identity card under a photo until the photo loads", () => {
    render(<PlayerPortrait name="Rohan Kulkarni" seed="reg-2" src="/p.jpg" />);
    const frame = screen.getByTestId("player-portrait");
    expect(frame).toHaveAttribute("data-state", "loading");
    expect(screen.getByTestId("portrait-initials")).toHaveTextContent("RK");
    const img = frame.querySelector("img");
    if (img === null) throw new Error("no img");
    fireEvent.load(img);
    expect(frame).toHaveAttribute("data-state", "photo");
    expect(screen.queryByTestId("portrait-initials")).toBeNull();
    expect(screen.getByRole("img", { name: "Rohan Kulkarni" })).toBe(img);
  });

  it("falls back to the identity card when the photo fails", () => {
    render(<PlayerPortrait name="Kunal Patil" seed="reg-3" src="/broken.jpg" />);
    const frame = screen.getByTestId("player-portrait");
    const img = frame.querySelector("img");
    if (img === null) throw new Error("no img");
    fireEvent.error(img);
    expect(frame).toHaveAttribute("data-state", "identity");
    expect(frame.querySelector("img")).toBeNull();
  });

  it("hides from assistive tech when decorative", () => {
    render(<PlayerPortrait name="Siddharth Iyer" seed="reg-4" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
