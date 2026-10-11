import { afterEach, expect, it, vi } from "vitest";
import { publicLiveState, replayMatch } from "@desiauction/core/scoring";
import { connectLive } from "./live-socket";
class Socket {
  static instances: Socket[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  close = vi.fn(() => {
    this.onclose?.();
  });
  constructor(readonly url: URL) {
    Socket.instances.push(this);
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Socket.instances = [];
});
function setup() {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", { location: { href: "https://desiauction.test/c/cup/m/1" } });
}
it("unset opt-in creates no socket, leaving the polling path untouched", () => {
  setup();
  const stop = connectLive(undefined, "fixture", {}, vi.fn());
  expect(Socket.instances).toHaveLength(0);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
it("subscribes with an exact same-origin URL and gate body, delivers and reconnects", () => {
  setup();
  const receive = vi.fn();
  const stop = connectLive("/live/ws", "fixture", { t: "secret", s: "cup" }, receive);
  const socket = Socket.instances[0];
  if (!socket) throw new Error("Missing socket");
  expect(socket.url.toString()).toBe("wss://desiauction.test/live/ws");
  socket.onopen?.();
  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ t: "sub", fixtureId: "fixture", gate: { t: "secret", s: "cup" } }),
  );
  const live = publicLiveState(replayMatch([]), { teams: {}, players: {} });
  socket.onmessage?.({ data: JSON.stringify({ t: "live", live }) });
  expect(receive).toHaveBeenCalledWith(live);
  socket.onclose?.();
  vi.advanceTimersByTime(1000);
  expect(Socket.instances).toHaveLength(2);
  stop();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60000);
  expect(Socket.instances).toHaveLength(2);
});
