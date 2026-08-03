"use client";

import { deriveCeremony, type AuctionSnapshot, type CeremonyState } from "@desiauction/core";
import { useEffect, useRef, useState } from "react";

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
 */
const FRAME_STALE_AFTER_MS = 25_000;

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

  // --- the frame watchdog ---------------------------------------------------
  const lastFrameAtRef = useRef(Date.now());
  const [frameStale, setFrameStale] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      setFrameStale(Date.now() - lastFrameAtRef.current > FRAME_STALE_AFTER_MS);
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
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | null = null;

    const connect = () => {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        attempt = 0;
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
              setCeremony(deriveCeremony(prevRef.current, frame.snapshot));
              prevRef.current = frame.snapshot;
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
        setConnection("reconnecting");
        attempt += 1;
        const backoff = Math.min(5_000, 250 * 2 ** attempt);
        timer = setTimeout(connect, backoff);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      socket?.close();
    };
  }, [wsUrl]);

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
