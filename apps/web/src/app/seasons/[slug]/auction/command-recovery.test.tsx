// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuctionCommands } from "./command-runtime";
import type { RecoveryMarker } from "./command-state";
import { CommandRecovery } from "./command-recovery";
vi.mock("../../../../server/auction/live-actions", () => ({ auctionRecoveryContext: vi.fn() }));
let root: Root | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function render(state: RecoveryMarker["state"] | null, active = false) {
  const commands = new AuctionCommands(
    "actor",
    "room",
    {
      read: () => Promise.resolve(undefined),
      update: () => Promise.resolve([]),
    },
    () => {},
  );
  commands.ready = true;
  commands.markers = state
    ? [
        {
          v: 1,
          commandId: "exact-command",
          actorId: "actor",
          auctionId: "room",
          control: "bid",
          type: "PlaceBid",
          resources: ["bidding"],
          context: {},
          state,
          acknowledgedVersion: state === "accepted" ? 1 : null,
          createdAt: new Date(0).toISOString(),
        },
      ]
    : [];
  vi.spyOn(commands, "isCommandPending").mockImplementation(
    (id) => active && id === "exact-command",
  );
  // Same control can be active for a different command; it must never hide restoration.
  vi.spyOn(commands, "pending").mockReturnValue(true);
  root = createRoot(host);
  const refresh = () => {
    act(() => {
      root?.render(<CommandRecovery commands={commands} slug="season" currentRoom={() => true} />);
    });
  };
  refresh();
  return { commands, refresh };
}
it("keeps idle and exact local preparation in the same compact region", () => {
  const { commands, refresh } = render("prepared", true);
  expect(host.querySelector('[data-presentation="pending"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="auction-command-recovery"]')).toBeNull();
  commands.markers = [];
  refresh();
  expect(host.querySelector('[data-presentation="idle"]')).not.toBeNull();
});
it("retains full recovery for restored preparation even when the same control is pending", () => {
  render("prepared");
  expect(host.querySelector('[data-testid="auction-command-recovery"]')?.textContent).toContain(
    "Command outcome unknown",
  );
  expect(host.querySelector("button")?.textContent).toContain("Reviewed current room");
});
it("states accepted truthfully while waiting for room observation", () => {
  render("accepted", true);
  expect(host.querySelector('[data-presentation="accepted"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="auction-command-recovery"]')).toBeNull();
});
it("never hides an unknown result behind a locally active identity", () => {
  render("unknown", true);
  expect(host.querySelector('[data-testid="auction-command-recovery"]')?.textContent).toContain(
    "Command outcome unknown",
  );
});
it("lets storage failure outrank routine preparation", () => {
  const { commands, refresh } = render("prepared", true);
  commands.error = "Storage failed";
  refresh();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Storage failed");
  expect(host.querySelector('[data-presentation="exception"]')).not.toBeNull();
});
it("keeps session ending immediately visible", () => {
  const { commands, refresh } = render(null);
  commands.stop();
  refresh();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("account session ended");
});

it("keeps an exact owned correction reservation routine between acknowledged Undo and Hold", () => {
  const { commands, refresh } = render(null);
  const lease = commands.acquireChain("UndoLastAction", {});
  if (!lease) throw new Error("No correction lease");
  commands.markers = [
    {
      v: 1,
      commandId: lease.commandId,
      actorId: "actor",
      auctionId: "room",
      control: "undo-hold",
      type: "UndoHoldChain",
      resources: ["bidding"],
      context: {},
      state: "prepared",
      acknowledgedVersion: null,
      createdAt: new Date(0).toISOString(),
    },
  ];
  refresh();
  expect(host.querySelector('[data-presentation="correction"]')?.textContent).toContain(
    "Lot hold not yet confirmed",
  );
  expect(host.querySelector('[data-testid="auction-command-recovery"]')).toBeNull();
  const chain = commands.markers[0];
  if (!chain) throw new Error("Missing chain");
  commands.markers.push({ ...chain, commandId: "lost-hold", type: "HoldLot", state: "unknown" });
  refresh();
  expect(host.querySelector('[data-testid="auction-command-recovery"]')?.textContent).toContain(
    "Command outcome unknown",
  );
});
it("shows restored correction reservation without its local lease as unresolved", () => {
  const { commands, refresh } = render("prepared");
  const marker = commands.markers[0];
  if (!marker) throw new Error("Missing marker");
  marker.type = "UndoHoldChain";
  refresh();
  expect(host.querySelector('[data-testid="auction-command-recovery"]')?.textContent).toContain(
    "Command outcome unknown",
  );
});
