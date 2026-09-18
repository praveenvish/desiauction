import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RollingNumber } from "./rolling-number";

describe("RollingNumber", () => {
  it("reads exactly the figure it was given, with no motion on first paint", () => {
    const { container } = render(<RollingNumber value="₹1,20,000" />);
    expect(container.textContent).toBe("₹1,20,000");
    expect(container.querySelectorAll('[data-testid="rolling-digit"]')).toHaveLength(0);
  });

  it("rolls only the digits that changed, carrying the outgoing digit", () => {
    const { container, rerender } = render(<RollingNumber value="₹95,000" />);
    rerender(<RollingNumber value="₹97,500" />);
    expect(container.textContent).toBe("₹97,500");
    const rolled = container.querySelectorAll('[data-testid="rolling-digit"]');
    // 5→7 and 0→5; the leading 9 and the trailing zeros stay still.
    expect(rolled).toHaveLength(2);
    expect(rolled[0]?.textContent).toBe("7");
    expect(rolled[0]?.getAttribute("data-prev")).toBe("5");
    expect(rolled[1]?.textContent).toBe("5");
    expect(rolled[1]?.getAttribute("data-prev")).toBe("0");
  });

  it("aligns from the right when the figure grows a place", () => {
    const { container, rerender } = render(<RollingNumber value="₹95,000" />);
    rerender(<RollingNumber value="₹1,00,000" />);
    expect(container.textContent).toBe("₹1,00,000");
    const rolled = Array.from(container.querySelectorAll('[data-testid="rolling-digit"]'));
    // The new leading "1" rolls in from nothing (data-prev empty), not from "₹".
    const leading = rolled.find((node) => node.textContent === "1");
    expect(leading?.getAttribute("data-prev")).toBe("");
  });

  it("never rolls punctuation or the currency sign", () => {
    const { container, rerender } = render(<RollingNumber value="₹9,999" />);
    rerender(<RollingNumber value="₹10,000" />);
    const rolled = Array.from(container.querySelectorAll('[data-testid="rolling-digit"]'));
    expect(rolled.every((node) => /^[0-9]$/.test(node.textContent))).toBe(true);
  });

  it("keeps rolling through an unrelated re-render instead of remounting the digits", () => {
    // A live room re-renders for reasons of its own (the clock, a new bidder
    // count) while a roll is still sliding. The previous value used to be a
    // ref already overwritten by then, so every rolling digit was re-keyed as
    // "still" and remounted, cutting the animation off part-way.
    const { container, rerender } = render(<RollingNumber value="₹95,000" />);
    rerender(<RollingNumber value="₹97,500" />);
    const before = Array.from(container.querySelectorAll('[data-testid="rolling-digit"]'));
    rerender(<RollingNumber value="₹97,500" className="pulse" />);
    const after = Array.from(container.querySelectorAll('[data-testid="rolling-digit"]'));
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it("rolls from the value it last showed, not from the one before that", () => {
    const { container, rerender } = render(<RollingNumber value="₹95,000" />);
    rerender(<RollingNumber value="₹97,500" />);
    rerender(<RollingNumber value="₹98,500" />);
    const rolled = container.querySelectorAll('[data-testid="rolling-digit"]');
    expect(rolled).toHaveLength(1);
    expect(rolled[0]?.textContent).toBe("8");
    expect(rolled[0]?.getAttribute("data-prev")).toBe("7");
  });
});
