import { describe, expect, it } from "vitest";
import { WriteScopes } from "./write-scope";

describe("conflicting registration write exclusion", () => {
  it("acquires synchronously before double activation can dispatch twice", () => {
    const scope = new WriteScopes();
    let dispatches = 0;
    const activate = () => {
      const lease = scope.acquire(["player"], ["team"]);
      if (lease) dispatches += 1;
      return lease;
    };
    expect(activate()).not.toBeNull();
    expect(activate()).toBeNull();
    expect(dispatches).toBe(1);
  });
  it("holds both an edited captain and the displaced captain through the check", () => {
    const scope = new WriteScopes();
    const lease = scope.acquire(["new", "old"], ["team"], ["team"]);
    if (!lease) throw new Error("Missing lease");
    scope.set(lease, "checking");
    expect(scope.acquire(["old"], ["team"])).toBeNull();
    expect(scope.acquire(["other-member"], ["team"])).toBeNull();
    expect(scope.status("old", "team")).toBe("checking");
    expect(scope.acquire(["unrelated"], ["other-team"])).not.toBeNull();
    scope.release(lease);
    expect(scope.acquire(["new"], ["team"])).not.toBeNull();
  });
  it("prevents a captain replacement starting over an existing member edit", () => {
    const scope = new WriteScopes();
    expect(scope.acquire(["member"], ["team"])).not.toBeNull();
    expect(scope.acquire(["captain"], ["team"], ["team"])).toBeNull();
    expect(scope.acquire(["another"], ["other-team"], ["other-team"])).not.toBeNull();
  });
  it("blocks bulk versus sheet requests in both directions including detached rows", () => {
    const scope = new WriteScopes();
    const sheet = scope.acquire(["off-page"], ["team"]);
    if (!sheet) throw new Error("Missing sheet lease");
    expect(scope.acquire([], [], [], true)).toBeNull();
    scope.release(sheet);
    const bulk = scope.acquire([], [], [], true);
    if (!bulk) throw new Error("Missing bulk lease");
    expect(scope.acquire(["off-page"], ["team"])).toBeNull();
    expect(scope.acquire([], [], [], true)).toBeNull();
    scope.release(bulk);
    expect(scope.acquire(["off-page"], ["team"])).not.toBeNull();
  });
  it("keeps uncertain changes locked instead of treating a lost response as refusal", () => {
    const scope = new WriteScopes();
    const lease = scope.acquire(["player"], []);
    if (!lease) throw new Error("Missing lease");
    scope.set(lease, "unconfirmed");
    expect(scope.status("player", null)).toBe("unconfirmed");
    expect(scope.acquire(["player"], [])).toBeNull();
    expect(scope.acquire(["unrelated"], [])).not.toBeNull();
  });
  it("invalidates an old Undo after a conflicting edit while retaining it for unrelated rows", () => {
    const scope = new WriteScopes();
    const first = scope.acquire(["player"], ["team"]);
    if (!first) throw new Error("Missing lease");
    scope.release(first);
    const unrelated = scope.acquire(["other"], ["other-team"]);
    expect(scope.current(first)).toBe(true);
    if (!unrelated) throw new Error("Missing unrelated lease");
    scope.release(unrelated);
    expect(scope.acquire(["player"], ["team"])).not.toBeNull();
    expect(scope.current(first)).toBe(false);
  });
});
