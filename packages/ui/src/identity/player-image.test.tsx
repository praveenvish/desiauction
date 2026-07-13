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
});
