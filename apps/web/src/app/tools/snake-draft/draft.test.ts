import { describe, expect, it } from "vitest";

import { snakeOrder } from "./draft";

describe("snakeOrder", () => {
  it("reverses the order every round", () => {
    expect(snakeOrder(["A", "B", "C"], 3)).toEqual([
      ["A", "B", "C"],
      ["C", "B", "A"],
      ["A", "B", "C"],
    ]);
  });

  it("gives every team the same number of picks", () => {
    const order = snakeOrder(["A", "B", "C", "D"], 5).flat();
    for (const team of ["A", "B", "C", "D"]) {
      expect(order.filter((pick) => pick === team)).toHaveLength(5);
    }
  });

  it("has no rounds for zero or negative rounds", () => {
    expect(snakeOrder(["A", "B"], 0)).toEqual([]);
    expect(snakeOrder(["A", "B"], -2)).toEqual([]);
  });
});
