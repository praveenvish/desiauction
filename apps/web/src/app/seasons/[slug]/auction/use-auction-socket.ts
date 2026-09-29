"use client";

import { deriveCeremony, type AuctionSnapshot, type CeremonyState } from "@desiauction/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  FRAME_STALE_AFTER_MS,
  mustReplaceSocket,
  reconnectDelayMs,
  shouldRefreshTicket,
} from "./socket-policy";

// The shared live-socket hook (M-IP4-3). One implementation for the cockpit,
// the bidder view and the spectator: connect, reconnect with backoff, reject
// out-of-order frames by snapshot version, correct the clock from the
// transport envelope, and derive the FLOODLIGHT ceremony from consecutive
// snapshots — presentation state only, zero business logic.

interface WireEnvelope {
  kind: "snapshot" | "heartbeat";
  serverNowMs: number;
  version: number;
  snapshot?: AuctionSnapshot;
}

export type ConnectionState = "connecting" | "open" | "reconnecting";

/**
 * THE FRAME WATCHDOG (DA-20).
 *
 * Staleness used to derive from the WebSocket `close` event alone. On venue
 * Wi-Fi that event frequently never arrives: a captive-portal reset or a
 * hotspot blackhole drops packets without ever sending a TCP FIN, `readyState`
 * stays OPEN, and the page reports a healthy connection over a snapshot the
 * engine stopped confirming minutes ago — a projector saying LIVE AUCTION with
 * a frozen room behind it.
 *
 * The engine already heartbeats every 10s. So the client keeps its own clock:
 * every frame — snapshot OR heartbeat — stamps `lastFrameAt`, and a 1s poll
 * declares the feed stale once nothing has landed for this long. Two missed
 * heartbeats plus margin: long enough that a hiccup does not flash a warning
 * over a live sale, short enough that a dead feed is named while the room is
 * still looking at it.
 *
 * DETECTING IT WAS HALF THE JOB. For the blackholed socket the watchdog set a
 * flag and nothing else: `onclose` never fires on a connection that was never
 * closed, so the reconnect below never ran, and the room told the owner it was
 * reconnecting while it sat on a dead socket until they reloaded the page. The
 * watchdog now REPLACES a socket that has gone silent (socket-policy.ts).
 */

/** How often the watchdog re-checks. Cheap: one boolean, no snapshot work. */
const WATCHDOG_TICK_MS = 1_000;

/**
 * The countdown clock, isolated.
 *
 * `remainingMs` used to be set at 10Hz, which re-rendered the ENTIRE consuming
 * panel — hero, purse board, squad board, timeline, pool summary — ten times a
 * second, for three hours, on a phone. Nothing on those panels can change
 * between two ticks of the same second.
 *
 * So the hook now publishes the countdown twice, for two different appetites:
 *
 *  - `remainingMs` is quantised to the whole second every consumer already
 *    renders (`Math.ceil(ms / 1000)`). React bails out of the re-render when
 *    the value is unchanged, so the tree re-renders once a second, not ten
 *    times — and not at all between lots.
 *  - `clock` is the raw 10Hz value behind a subscription, for the one consumer
 *    that genuinely needs sub-second resolution (the countdown ring). Reading
 *    it re-renders only the component that subscribed.
 */
export interface AuctionClock {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number | null;
}

export interface AuctionSocket {
  snapshot: AuctionSnapshot | null;
  connection: ConnectionState;
  /** serverNow − clientNow at the last frame (countdown correction). */
  drift: number;
  /** Drift-corrected remaining time of the current lot, null when timerless. */
  remainingMs: number | null;
  version: number;
  ceremony: CeremonyState;
  /**
   * The snapshot on screen is no longer being confirmed by the engine — the
   * socket is down, or this device has no network. Everything derived from it
   * (the countdown above all) is a memory, not a fact.
   */
  stale: boolean;
  /** The DEVICE is offline, which is a stronger claim than "reconnecting". */
  offline: boolean;
  /**
   * The socket still reports OPEN but no frame — snapshot or heartbeat — has
   * landed inside the watchdog window. The blackholed-connection case: the one
   * kind of staleness `connection` can never see.
   */
  frameStale: boolean;
  /** Sub-second countdown for the few consumers that animate it. */
  clock: AuctionClock;
}

export function useAuctionSocket(wsUrl: string): AuctionSocket {
  const [snapshot, setSnapshot] = useState<AuctionSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [drift, setDrift] = useState(0);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [ceremony, setCeremony] = useState<CeremonyState>({ phase: "idle", key: "idle" });
  const [offline, setOffline] = useState(false);
  /**
   * The ORDERING key stays a ref — the message handler must compare against the
   * newest value synchronously, and a state read inside the closure would be a
   * frame behind. But the hook also RETURNED the ref's value, so `version` never
   * triggered a render: every surface showing "v58" was showing whatever the
   * counter happened to be at the last render some other state caused.
   */
  const versionRef = useRef(0);
  const [version, setVersion] = useState(0);
  const prevRef = useRef<AuctionSnapshot | null>(null);

  const router = useRouter();
  /** Abandon the current socket and connect again; set by the connect effect. */
  const replaceSocketRef = useRef<(reason: "silent" | "online") => void>(() => undefined);
  /** The current socket's readyState, or null when there is none. */
  const readyStateRef = useRef<() => number | null>(() => null);

  // --- the frame watchdog ---------------------------------------------------
  const lastFrameAtRef = useRef(Date.now());
  const [frameStale, setFrameStale] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      const nowMs = Date.now();
      setFrameStale(nowMs - lastFrameAtRef.current > FRAME_STALE_AFTER_MS);
      if (
        mustReplaceSocket({
          readyState: readyStateRef.current(),
          lastFrameAtMs: lastFrameAtRef.current,
          nowMs,
        })
      ) {
        replaceSocketRef.current("silent");
      }
    }, WATCHDOG_TICK_MS);
    return () => {
      clearInterval(interval);
    };
  }, []);

  // --- the isolated sub-second clock ----------------------------------------
  const clockRef = useRef<{ value: number | null; listeners: Set<() => void> }>({
    value: null,
    listeners: new Set(),
  });
  const clock = useRef<AuctionClock>({
    subscribe: (listener) => {
      clockRef.current.listeners.add(listener);
      return () => {
        clockRef.current.listeners.delete(listener);
      };
    },
    getSnapshot: () => clockRef.current.value,
  }).current;
  const publishClock = (value: number | null) => {
    if (clockRef.current.value === value) {
      return;
    }
    clockRef.current.value = value;
    for (const listener of clockRef.current.listeners) {
      listener();
    }
  };

  // navigator.onLine is a weak signal on its own — it says the interface is up,
  // not that the engine is reachable — but a false is definitive, and it lets
  // the room say "Offline" instead of an optimistic "Reconnecting…".
  useEffect(() => {
    const sync = () => {
      setOffline(!window.navigator.onLine);
    };
    // The network came back: whatever socket survived the gap is suspect, and
    // waiting out the rest of a backoff (or of the watchdog's window) is time
    // the owner spends unable to bid. Connect now.
    const back = () => {
      sync();
      replaceSocketRef.current("online");
    };
    sync();
    window.addEventListener("online", back);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", back);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | null = null;

    // Failures since the last socket that actually OPENED — what decides
    // whether the ticket in `wsUrl` is worth asking for again.
    let failures = 0;

    const retry = () => {
      setConnection("reconnecting");
      attempt += 1;
      failures += 1;
      if (shouldRefreshTicket(failures)) {
        // A new render mints a new ticket; if the URL changes, this effect
        // restarts on it. If the engine is simply down, nothing changes.
        router.refresh();
      }
      timer = setTimeout(connect, reconnectDelayMs(attempt));
    };

    const connect = () => {
      socket = new WebSocket(wsUrl);
      // A new socket gets a full window to speak before the watchdog judges it.
      lastFrameAtRef.current = Date.now();
      socket.onopen = () => {
        attempt = 0;
        failures = 0;
        setConnection("open");
        // A fresh socket has not been given a chance to speak yet; do not let
        // the watchdog inherit the outage that caused the reconnect.
        lastFrameAtRef.current = Date.now();
        setFrameStale(false);
      };
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data as string) as WireEnvelope;
          // EVERY well-formed frame is proof of life, heartbeats included.
          lastFrameAtRef.current = Date.now();
          setFrameStale(false);
          setDrift(frame.serverNowMs - Date.now());
          if (frame.kind === "snapshot" && frame.snapshot !== undefined) {
            // Out-of-order rejection: never apply a frame older than we hold.
            if (frame.version >= versionRef.current) {
              versionRef.current = frame.version;
              setVersion(frame.version);
              // `prev` is captured here, not read inside the updater: React may
              // run the updater after the ref below has already moved on.
              const prev = prevRef.current;
              const next = frame.snapshot;
              setCeremony((current) => deriveCeremony(prev, next, current));
              prevRef.current = next;
              setSnapshot(frame.snapshot);
            }
          }
        } catch {
          // Malformed frame: ignore — the next snapshot supersedes everything.
        }
      };
      socket.onclose = () => {
        if (closed) {
          return;
        }
        /*
         * BACKOFF WITH JITTER, BECAUSE EVERY CLIENT LOSES THE SOCKET AT ONCE.
         *
         * The thing that closes these sockets is almost never one client's
         * network: it is the engine restarting — a deploy, a crash, an OOM.
         * When that happens every screen in the room disconnects in the same
         * millisecond and, on a pure exponential schedule, reconnects in the
         * same millisecond too, for as long as the engine takes to come back.
         * A projector, a conductor's laptop, eight owners' phones and a hall of
         * spectators then arrive as one synchronized wave against a process
         * that is still replaying its event log — and the per-room and per-IP
         * caps refuse the overflow, which turns one restart into a room that
         * cannot get back in.
         *
         * Full jitter (`random() * ceiling`, AWS's term) spreads the same
         * clients across the whole window instead of stacking them on its edge.
         * It costs one multiplication and it is the difference between a herd
         * and a queue. The floor keeps a fast reconnect fast.
         */
        retry();
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    /**
     * Let go of a socket WITHOUT waiting for it to agree. `close()` on a
     * connection whose other end is unreachable starts a closing handshake
     * nobody will answer, and `onclose` may not fire for a long time — so the
     * handlers come off first, and the replacement is scheduled here rather
     * than from an event that might never arrive.
     */
    const abandon = () => {
      const old = socket;
      socket = null;
      if (old === null) {
        return;
      }
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      try {
        old.close();
      } catch {
        // Already gone.
      }
    };

    readyStateRef.current = () => socket?.readyState ?? null;
    replaceSocketRef.current = (reason) => {
      if (closed) {
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      abandon();
      if (reason === "online") {
        // The network is back this instant: no reason to wait out a backoff.
        attempt = 0;
        setConnection("reconnecting");
        connect();
        return;
      }
      retry();
    };

    connect();
    return () => {
      closed = true;
      readyStateRef.current = () => null;
      replaceSocketRef.current = () => undefined;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      socket?.close();
    };
    // `router` is stable for the life of the page (next/navigation).
  }, [wsUrl, router]);

  // Countdown: render-only; endsAt is server truth, drift-corrected.
  //
  // It FREEZES the moment the socket goes down. The clock used to tick on
  // regardless — 37s → 34s → 14s across twenty-three seconds with no connection
  // — which is the page inventing the one number the room is watching. A frozen
  // clock beside a "Reconnecting…" badge is honest; a running one is a lie that
  // looks exactly like the truth.
  const stale = connection !== "open" || offline || frameStale;
  const endsAtMs = snapshot?.currentLot?.endsAtMs ?? null;
  useEffect(() => {
    if (stale || endsAtMs === null) {
      // No live clock to run: publish the frozen/absent value ONCE rather than
      // waking a 10Hz timer for the whole interval between lots.
      if (endsAtMs === null) {
        setRemainingMs(null);
        publishClock(null);
      }
      return;
    }
    const tick = () => {
      const raw = Math.max(0, endsAtMs - (Date.now() + drift));
      publishClock(raw);
      // Quantised to the displayed second: React bails out when unchanged, so
      // the consuming tree renders once a second instead of ten times.
      setRemainingMs(Math.ceil(raw / 1000) * 1000);
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => {
      clearInterval(interval);
    };
    // `publishClock` reads only refs, so it is stable across renders and is
    // deliberately not a dependency.
  }, [endsAtMs, drift, stale]);

  return {
    snapshot,
    connection,
    drift,
    remainingMs,
    version,
    ceremony,
    stale,
    offline,
    frameStale,
    clock,
  };
}
