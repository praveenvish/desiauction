import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerImage } from "./player-image";

describe("PlayerImage", () => {
  it("renders the branded mark when no photo exists — never a silhouette", () => {
    render(<PlayerImage name="Rohit Sharma" seed="p1" />);
    const frame = screen.getByTestId("player-image");
    expect(frame).toHaveAttribute("data-state", "mark");
    expect(screen.getByRole("img", { name: "Rohit Sharma" })).toBeInTheDocument();
    expect(frame.querySelector("text")).toHaveTextContent("RS");
  });

  it("falls back to the mark when the photo fails to load", () => {
    render(<PlayerImage name="Virat Kohli" seed="p2" src="/broken.jpg" />);
    const frame = screen.getByTestId("player-image");
    expect(frame).toHaveAttribute("data-state", "loading");
    const img = frame.querySelector("img");
    expect(img).not.toBeNull();
    if (img !== null) {
      fireEvent.error(img);
    }
    expect(frame).toHaveAttribute("data-state", "mark");
    expect(frame.querySelector("text")).toHaveTextContent("VK");
  });

  it("shows the photo once loaded, with fixed dimensions (zero CLS)", () => {
    render(<PlayerImage name="Smriti M" seed="p3" src="/photo.jpg" size="xl" />);
    const frame = screen.getByTestId("player-image");
    const img = frame.querySelector("img");
    expect(img).toHaveAttribute("width", "96");
    expect(img).toHaveAttribute("height", "96");
    if (img !== null) {
      fireEvent.load(img);
    }
    expect(frame).toHaveAttribute("data-state", "photo");
    expect(img).toHaveAttribute("alt", "Smriti M");
  });

  it("renders Devanagari initials without breaking graphemes", () => {
    render(<PlayerImage name="रोहित शर्मा" seed="p4" />);
    const frame = screen.getByTestId("player-image");
    expect(frame.querySelector("text")).toHaveTextContent("रोश");
  });

  it("renders the neutral diamond mark when the name is unknowable", () => {
    render(<PlayerImage name="" seed="p5" />);
    const frame = screen.getByTestId("player-image");
    expect(frame.querySelector("text")).toBeNull();
    expect(frame.querySelector("path")).not.toBeNull();
  });

  it("identity is stable across re-renders (deterministic)", () => {
    const { unmount } = render(<PlayerImage name="Hardik P" seed="stable" />);
    const first = screen
      .getByTestId("player-image")
      .querySelector("svg")
      ?.getAttribute("data-pattern");
    unmount();
    render(<PlayerImage name="Hardik P" seed="stable" />);
    const second = screen
      .getByTestId("player-image")
      .querySelector("svg")
      ?.getAttribute("data-pattern");
    expect(first).toBe(second);
  });

  it("treats a null src as no photo — the consent-gated view model passes straight through", () => {
    render(<PlayerImage name="Rohit Sharma" seed="p6" src={null} />);
    const frame = screen.getByTestId("player-image");
    expect(frame).toHaveAttribute("data-state", "mark");
    expect(frame.querySelector("img")).toBeNull();
  });

  it("decorative: hides from assistive tech so a name printed beside it is read once", () => {
    const { unmount } = render(<PlayerImage name="Rohit Sharma" seed="p7" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("player-image").querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    unmount();
    render(<PlayerImage name="Rohit Sharma" seed="p7" src="/photo.jpg" decorative />);
    expect(screen.getByTestId("player-image").querySelector("img")).toHaveAttribute("alt", "");
  });

  it("fluid: leaves the box to the caller but keeps the intrinsic resolution", () => {
    render(<PlayerImage name="Rohit Sharma" seed="p8" size="hero" src="/photo.jpg" fluid />);
    const frame = screen.getByTestId("player-image");
    expect(frame.getAttribute("style")).toBeNull();
    expect(frame.querySelector("img")).toHaveAttribute("width", "160");
  });
});
