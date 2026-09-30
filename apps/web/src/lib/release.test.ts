import { describe, expect, it } from "vitest";

import { release } from "./release";

describe("release", () => {
  it("hands back the result, having let go first", async () => {
    const order: string[] = [];
    const result = await release(
      Promise.resolve("saved").then((value) => {
        order.push("answered");
        return value;
      }),
      () => order.push("released"),
    );
    order.push("handled");
    expect(result).toBe("saved");
    expect(order).toEqual(["answered", "released", "handled"]);
  });

  it("lets go when the work never came back, and passes the failure on", async () => {
    let released = 0;
    await expect(
      release(Promise.reject(new Error("Failed to fetch")), () => {
        released += 1;
      }),
    ).rejects.toThrow("Failed to fetch");
    expect(released).toBe(1);
  });
});
