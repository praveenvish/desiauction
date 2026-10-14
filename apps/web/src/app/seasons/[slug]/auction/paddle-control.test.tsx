// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerStance } from "./owner-state";
import { PaddleControl } from "./paddle-control";

const rules = {
  pursePerTeam: 10000000,
  squadMin: 12,
  squadMax: 12,
  minPossiblePrice: 100000,
  initialSeconds: 30,
  extensionSeconds: 10,
  slabs: [{ upTo: null, step: 50000 }],
};
const stance = (raise = 100000): OwnerStance => ({
  kind: "open",
  reason: null,
  raise,
  jumps: [raise + 50000, raise + 100000, raise + 150000],
  ceiling: 10000000,
  leader: null,
  stillToBuy: 11,
});
let root: Root;
let host: HTMLDivElement;
let send: ReturnType<typeof vi.fn>;
let current = {
  lotId: "lot-1",
  bidScope: "actor:room:paddle",
  stance: stance(),
  readOnly: false,
  busy: false,
};
function render(change: Partial<typeof current> = {}) {
  current = { ...current, ...change };
  act(() => {
    root.render(<PaddleControl {...current} rules={rules} squadSigned={1} onBid={send} />);
  });
}
function button() {
  const control = host.querySelector<HTMLButtonElement>('[data-testid="bid-next"]');
  if (!control) throw new Error("Missing actual paddle button");
  return control;
}
function pointer(type: string, pointerId = 1, primary = true) {
  act(() => {
    const event = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(event, "isPrimary", { value: primary });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    button().dispatchEvent(event);
  });
}
function key(type: string, value: string, repeat = false) {
  let accepted = true;
  act(() => {
    accepted = button().dispatchEvent(
      new KeyboardEvent(type, { key: value, repeat, bubbles: true, cancelable: true }),
    );
  });
  return accepted;
}
function click(detail = 1, pointerId: number | null = detail > 0 ? 1 : null) {
  act(() => {
    const event = new MouseEvent("click", { bubbles: true, detail });
    if (pointerId !== null) Object.defineProperty(event, "pointerId", { value: pointerId });
    button().dispatchEvent(event);
  });
}
async function retireReleasedPointers() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  send = vi.fn();
  current = {
    lotId: "lot-1",
    bidScope: "actor:room:paddle",
    stance: stance(),
    readOnly: false,
    busy: false,
  };
  render();
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe("physical auction bid intent", () => {
  it("primary mouse focus retains the press without submitting or reviving canceled intent", () => {
    const focus = vi.spyOn(button(), "focus");
    pointer("pointerdown");
    let accepted = true;
    act(() => {
      accepted = button().dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(accepted).toBe(false);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(send).not.toHaveBeenCalled();
    render({ stance: stance(150000) });
    pointer("pointerup");
    click();
    expect(send).not.toHaveBeenCalled();
    pointer("pointerdown");
    act(() => {
      button().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    const other = document.createElement("input");
    host.append(other);
    act(() => {
      other.focus();
    });
    pointer("pointerup");
    click();
    expect(send).not.toHaveBeenCalled();
    other.remove();
    focus.mockRestore();
  });
  it("accepts an unchanged pointer gesture and an explicit assistive activation", () => {
    pointer("pointerdown");
    pointer("pointerup");
    click();
    click(0);
    expect(send.mock.calls).toEqual([[100000], [100000]]);
  });
  it.each(["amount", "lot", "scope", "eligibility"])(
    "cancels a changed %s even when the original state returns",
    (kind) => {
      pointer("pointerdown");
      if (kind === "amount") render({ stance: stance(150000) });
      if (kind === "lot") render({ lotId: "lot-2" });
      if (kind === "scope") render({ bidScope: "actor:other-room:paddle" });
      if (kind === "eligibility") render({ readOnly: true });
      render({ lotId: "lot-1", bidScope: "actor:room:paddle", stance: stance(), readOnly: false });
      pointer("pointerup");
      click();
      expect(send).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="bid-gesture-status"]')?.textContent).toContain(
        "press again",
      );
      pointer("pointerdown");
      pointer("pointerup");
      click();
      expect(send).toHaveBeenCalledWith(100000);
    },
  );
  it.each(["pointercancel", "lostpointercapture", "blur"])(
    "does not dispatch a canceled %s gesture",
    (type) => {
      pointer("pointerdown");
      if (type === "blur")
        act(() => {
          window.dispatchEvent(new Event("blur"));
        });
      else pointer(type);
      pointer("pointerup");
      click();
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("allows implicit capture release after normal pointerup", () => {
    pointer("pointerdown");
    pointer("pointerup");
    pointer("lostpointercapture");
    click();
    expect(send).toHaveBeenCalledWith(100000);
  });
  it.each(["Enter", " "])("retains the original %s amount and rejects key repeats", (value) => {
    key("keydown", value);
    render({ stance: stance(150000) });
    expect(key("keydown", value, true)).toBe(false);
    key("keyup", value);
    click(0);
    expect(send).not.toHaveBeenCalled();
    key("keydown", value);
    click(0);
    click(0);
    expect(send.mock.calls).toEqual([[150000]]);
  });
  it("chips choose an exact amount without sending money and an invalidated choice cannot retarget a held bid", () => {
    const chip = host.querySelector<HTMLButtonElement>('[data-testid="bid-jump-200000"]');
    if (!chip) throw new Error("Missing amount chip");
    act(() => {
      chip.click();
    });
    expect(send).not.toHaveBeenCalled();
    expect(button().dataset["amount"]).toBe("200000");
    key("keydown", " ");
    render({ stance: stance(250000) });
    key("keyup", " ");
    click(0);
    expect(send).not.toHaveBeenCalled();
    key("keydown", " ");
    click(0);
    expect(send).toHaveBeenCalledWith(250000);
  });
  it("keeps a held Space identity when a separate pointer activation occurs", () => {
    key("keydown", " ");
    render({ stance: stance(150000) });
    pointer("pointerdown");
    pointer("pointerup");
    click();
    expect(send.mock.calls).toEqual([[150000]]);
    render({ stance: stance(200000) });
    key("keyup", " ");
    click(0);
    expect(send.mock.calls).toEqual([[150000]]);
  });
  it("retains held Space through a separate Enter activation", () => {
    key("keydown", " ");
    render({ stance: stance(150000) });
    key("keydown", "Enter");
    click(0);
    key("keyup", "Enter");
    expect(send.mock.calls).toEqual([[150000]]);
    render({ stance: stance(200000) });
    key("keyup", " ");
    click(0);
    expect(send.mock.calls).toEqual([[150000]]);
  });
  it.each(["original first", "mouse first"])(
    "retains primary touch and mouse identities: %s",
    (order) => {
      pointer("pointerdown", 2);
      render({ stance: stance(150000) });
      pointer("pointerdown", 1);
      if (order === "original first") {
        pointer("pointerup", 2);
        click(1, 2);
        expect(send).not.toHaveBeenCalled();
      }
      pointer("pointerup", 1);
      click(1, 1);
      expect(send.mock.calls).toEqual([[150000]]);
      render({ stance: stance(200000) });
      if (order === "mouse first") {
        pointer("pointerup", 2);
        click(1, 2);
      }
      expect(send.mock.calls).toEqual([[150000]]);
      pointer("pointerdown", 1);
      pointer("pointerup", 1);
      click(1, 1);
      expect(send.mock.calls).toEqual([[150000], [200000]]);
    },
  );
  it("identity-less completion fails closed when another canceled pointer remains held", () => {
    pointer("pointerdown", 2);
    render({ stance: stance(150000) });
    pointer("pointerdown", 1);
    pointer("pointerup", 1);
    click(1, null);
    expect(send).not.toHaveBeenCalled();
    click(1, 1);
    expect(send).not.toHaveBeenCalled();
    pointer("pointerup", 2);
    click(1, null);
    expect(send).not.toHaveBeenCalled();
    click(1, 2);
    expect(send).not.toHaveBeenCalled();
    pointer("pointerdown", 1);
    pointer("pointerup", 1);
    click(1, 1);
    expect(send.mock.calls).toEqual([[150000]]);
  });
  it("unknown and nonprimary pointer clicks never become assistive activations", () => {
    click(0, 99);
    pointer("pointerdown", 2, false);
    pointer("pointerup", 2, false);
    click(0, 2);
    expect(send).not.toHaveBeenCalled();
    click(0);
    expect(send.mock.calls).toEqual([[100000]]);
  });
  it("allows an unambiguous identity-less pointer completion", () => {
    pointer("pointerdown");
    pointer("pointerup");
    click(1, null);
    expect(send.mock.calls).toEqual([[100000]]);
  });
  it("recovers an identity-less press after a canceled touch retires", async () => {
    pointer("pointerdown", 2);
    pointer("pointercancel", 2);
    await retireReleasedPointers();
    pointer("pointerdown", 1);
    pointer("pointerup", 1);
    click(1, null);
    expect(send.mock.calls).toEqual([[100000]]);
  });
  it("observes release outside the button and permits the next press", async () => {
    pointer("pointerdown", 1);
    const release = new MouseEvent("pointerup", { bubbles: true });
    Object.defineProperty(release, "pointerId", { value: 1 });
    act(() => {
      document.body.dispatchEvent(release);
    });
    await retireReleasedPointers();
    expect(send).not.toHaveBeenCalled();
    pointer("pointerdown", 1);
    pointer("pointerup", 1);
    click(1, null);
    expect(send.mock.calls).toEqual([[100000]]);
  });
  it.each(["touch first", "mouse first"])(
    "fallback-only overlap recovers after both %s streams complete",
    async (order) => {
      pointer("pointerdown", 2);
      render({ stance: stance(150000) });
      pointer("pointerdown", 1);
      const ids = order === "touch first" ? [2, 1] : [1, 2];
      for (const id of ids) {
        pointer("pointerup", id);
        click(1, null);
      }
      expect(send).not.toHaveBeenCalled();
      await retireReleasedPointers();
      pointer("pointerdown", 1);
      pointer("pointerup", 1);
      click(1, null);
      expect(send.mock.calls).toEqual([[150000]]);
    },
  );
  it("old retirement cannot remove a newer press that reuses its pointer ID", async () => {
    pointer("pointerdown", 1);
    pointer("pointerup", 1);
    click(1, null);
    pointer("pointerdown", 1);
    await retireReleasedPointers();
    pointer("pointerup", 1);
    click(1, null);
    expect(send.mock.calls).toEqual([[100000], [100000]]);
  });
  it("a key released after focus leaves Bid does not block a later assistive activation", async () => {
    act(() => {
      button().focus();
    });
    key("keydown", " ");
    const other = document.createElement("input");
    host.append(other);
    act(() => {
      other.focus();
      other.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    });
    await retireReleasedPointers();
    act(() => {
      button().focus();
    });
    click(0);
    expect(send.mock.calls).toEqual([[100000]]);
  });
  it("a secondary touch cannot replace the primary gesture's original amount", () => {
    pointer("pointerdown");
    render({ stance: stance(150000) });
    pointer("pointerdown", 2, false);
    pointer("pointerup");
    click();
    expect(send).not.toHaveBeenCalled();
  });
});
