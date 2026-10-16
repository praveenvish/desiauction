import { projectRaidClockContext } from "@desiauction/core/scoring/raid-clock";
import type {
  PublicScoringState as PublicLiveState,
  RaidClockContext,
} from "@desiauction/core/scoring";
export function connectLive(
  path: string | undefined,
  fixtureId: string,
  gate: { s?: string; t?: string },
  receive: (live: PublicLiveState | null, clock?: RaidClockContext) => void,
) {
  if (path !== "/live/ws")
    return () => {
      /* Socket transport is optional; polling stays active. */
    };
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  function connect() {
    if (stopped) return;
    try {
      const url = new URL("/live/ws", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = () => {
        failures = 0;
        socket?.send(JSON.stringify({ t: "sub", fixtureId, gate }));
      };
      socket.onmessage = (event) => {
        try {
          const body = JSON.parse(String(event.data)) as {
            t?: string;
            live?: PublicLiveState | null;
            clock?: unknown;
          };
          if (body.t === "live" && body.live !== undefined) {
            const clock = projectRaidClockContext(body.clock);
            if (clock) receive(body.live, clock);
            else receive(body.live);
          }
        } catch {
          socket?.close();
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onclose = () => {
        if (!stopped)
          retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
      };
    } catch {
      retry = setTimeout(connect, 30000);
    }
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
  };
}
