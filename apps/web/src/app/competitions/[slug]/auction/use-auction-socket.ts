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

export interface AuctionSocket {
  snapshot: AuctionSnapshot | null;
  connection: ConnectionState;
  /** serverNow − clientNow at the last frame (countdown correction). */
  drift: number;
  /** Drift-corrected remaining time of the current lot, null when timerless. */
  remainingMs: number | null;
  version: number;
  ceremony: CeremonyState;
}

export function useAuctionSocket(wsUrl: string): AuctionSocket {
  const [snapshot, setSnapshot] = useState<AuctionSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [drift, setDrift] = useState(0);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [ceremony, setCeremony] = useState<CeremonyState>({ phase: "idle", key: "idle" });
  const versionRef = useRef(0);
  const prevRef = useRef<AuctionSnapshot | null>(null);

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
      };
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data as string) as WireEnvelope;
          setDrift(frame.serverNowMs - Date.now());
          if (frame.kind === "snapshot" && frame.snapshot !== undefined) {
            // Out-of-order rejection: never apply a frame older than we hold.
            if (frame.version >= versionRef.current) {
              versionRef.current = frame.version;
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
  useEffect(() => {
    const interval = setInterval(() => {
      const endsAtMs = snapshot?.currentLot?.endsAtMs ?? null;
      if (endsAtMs === null) {
        setRemainingMs(null);
        return;
      }
      setRemainingMs(Math.max(0, endsAtMs - (Date.now() + drift)));
    }, 100);
    return () => {
      clearInterval(interval);
    };
  }, [snapshot, drift]);

  return { snapshot, connection, drift, remainingMs, version: versionRef.current, ceremony };
}
