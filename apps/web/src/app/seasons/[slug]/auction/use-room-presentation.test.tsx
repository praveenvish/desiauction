// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useRoomPresentation } from "./use-room-presentation";

const cleanups: Array<() => void> = [];
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function mounted() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let value: ReturnType<typeof useRoomPresentation> | undefined;
  function Probe({ actor, room }: { actor: string; room: string }) {
    value = useRoomPresentation(actor, room);
    return null;
  }
  const commit = (actor: string, room: string) => {
    act(() => {
      root.render(<Probe actor={actor} room={room} />);
    });
    if (!value) throw new Error("Presentation did not commit");
    return value;
  };
  let unmounted = false;
  const unmount = () => {
    if (!unmounted)
      act(() => {
        root.unmount();
      });
    unmounted = true;
    host.remove();
  };
  cleanups.push(unmount);
  return { commit, unmount };
}

describe("committed room presentation identity", () => {
  it("invalidates old room captures across A to B to A without reviving them", () => {
    const panel = mounted();
    const a = panel.commit("owner", "A");
    const first = a.capture();
    expect(a.current(first)).toBe(true);
    const b = panel.commit("owner", "B");
    const second = b.capture();
    expect(a.current(first)).toBe(false);
    expect(b.current(second)).toBe(true);
    const returned = panel.commit("owner", "A");
    expect(returned.current(first)).toBe(false);
    expect(returned.current(second)).toBe(false);
    expect(returned.current(returned.capture())).toBe(true);
  });

  it("keeps same-identity renders valid and invalidates actor changes and unmount", () => {
    const panel = mounted();
    const original = panel.commit("owner", "A");
    const captured = original.capture();
    expect(panel.commit("owner", "A").current(captured)).toBe(true);
    const changed = panel.commit("other owner", "A");
    expect(changed.current(captured)).toBe(false);
    const latest = changed.capture();
    expect(changed.current(latest)).toBe(true);
    panel.unmount();
    expect(changed.current(latest)).toBe(false);
  });
});
