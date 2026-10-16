import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NoPhotoStyleProvider } from "./no-photo-style";
import { PlayerImage, smallCopyOf } from "./player-image";

describe("PlayerImage", () => {
  it("renders the branded mark when no photo exists — initials by default", () => {
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

  it("renders Devanagari initials as base letters", () => {
    render(<PlayerImage name="रोहित शर्मा" seed="p4" />);
    const frame = screen.getByTestId("player-image");
    expect(frame.querySelector("text")).toHaveTextContent("रश");
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

  describe("the 256px small copy", () => {
    const ID = "01HZX5Q8Y3J0K4M6N7P8R9S0TA";
    const photo = `https://media.example/org/${ID}/player/${ID}/${ID}.jpg`;
    const small = `https://media.example/org/${ID}/player/${ID}/${ID}-256.webp`;

    it("is derived only for a stored player photo", () => {
      expect(smallCopyOf(photo)).toBe(small);
      expect(smallCopyOf(`/_media/org/${ID}/player/${ID}/${ID}.png`)).toBe(
        `/_media/org/${ID}/player/${ID}/${ID}-256.webp`,
      );
      expect(smallCopyOf(`/_media/org/${ID}/team/${ID}/${ID}.png`)).toBeNull();
      expect(smallCopyOf("blob:https://app/123")).toBeNull();
      expect(smallCopyOf("/photo.jpg")).toBeNull();
    });

    it("a small frame loads the small copy, then the photo, then the mark", () => {
      render(<PlayerImage name="Anil K" seed="s1" src={photo} size="md" />);
      const frame = screen.getByTestId("player-image");
      const img = () => frame.querySelector("img");
      expect(img()).toHaveAttribute("src", small);
      fireEvent.error(img() as HTMLImageElement);
      expect(img()).toHaveAttribute("src", photo);
      fireEvent.error(img() as HTMLImageElement);
      expect(frame).toHaveAttribute("data-state", "mark");
    });

    it("the hero frame keeps the full photo", () => {
      render(<PlayerImage name="Anil K" seed="s2" src={photo} size="hero" />);
      expect(screen.getByTestId("player-image").querySelector("img")).toHaveAttribute("src", photo);
    });
  });

  describe("the season's silhouette (0107)", () => {
    it("draws the cricketer when the season chose it, not the initials", () => {
      render(
        <NoPhotoStyleProvider style="silhouette">
          <PlayerImage name="Rohit Sharma" seed="s1" />
        </NoPhotoStyleProvider>,
      );
      const frame = screen.getByTestId("player-image");
      expect(frame.querySelector("[data-placeholder='silhouette']")).not.toBeNull();
      expect(frame.querySelector("text")).toBeNull();
      // Still named for assistive tech.
      expect(screen.getByRole("img", { name: "Rohit Sharma" })).toBeInTheDocument();
    });

    it("a real photo still wins over the silhouette", () => {
      render(
        <NoPhotoStyleProvider style="silhouette">
          <PlayerImage name="Rohit Sharma" seed="s2" src="/photo.jpg" />
        </NoPhotoStyleProvider>,
      );
      expect(screen.getByTestId("player-image").querySelector("img")).not.toBeNull();
    });

    it("the prop overrides the season", () => {
      render(
        <NoPhotoStyleProvider style="silhouette">
          <PlayerImage name="Rohit Sharma" seed="s3" noPhoto="initials" />
        </NoPhotoStyleProvider>,
      );
      expect(screen.getByTestId("player-image").querySelector("text")).toHaveTextContent("RS");
    });
  });
});
