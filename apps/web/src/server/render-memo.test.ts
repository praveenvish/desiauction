import { describe, expect, it } from "vitest";

import { sharedPerRender } from "./render-memo";

/*
 * Outside a React server render — every server action, route handler, job and
 * test — nothing may be shared: an action that writes a grant and then checks
 * one must read its own write. This is the property the grants and tenant reads
 * rely on, so it is pinned here. (Inside a render the sharing itself is proved
 * against the production build: one grants read per page.)
 */
describe("sharedPerRender outside a render", () => {
  it("runs the read on every call, even for the same key", async () => {
    const shared = sharedPerRender<number>();
    let reads = 0;
    const read = (): Promise<number> => Promise.resolve(++reads);
    expect(await shared(["p1"], read)).toBe(1);
    expect(await shared(["p1"], read)).toBe(2);
    expect(reads).toBe(2);
  });

  it("does not remember a failure", async () => {
    const shared = sharedPerRender<string>();
    await expect(shared(["p1"], () => Promise.reject(new Error("blip")))).rejects.toThrow("blip");
    await expect(shared(["p1"], () => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});
