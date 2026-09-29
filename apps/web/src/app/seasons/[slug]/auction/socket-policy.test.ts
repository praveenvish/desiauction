import { describe, expect, it } from "vitest";

import {
  BACKOFF_CEILING_MS,
  FRAME_STALE_AFTER_MS,
  REFRESH_EVERY_ATTEMPTS,
  mustReplaceSocket,
  reconnectDelayMs,
  shouldRefreshTicket,
} from "./socket-policy";

const OPEN = 1;
const CONNECTING = 0;
const CLOSING = 2;
const CLOSED = 3;

describe("a blackholed socket is replaced, not just labelled", () => {
  const now = 1_000_000;

  it("replaces a socket that says OPEN and has been silent past the window", () => {
    expect(
      mustReplaceSocket({
        readyState: OPEN,
        lastFrameAtMs: now - FRAME_STALE_AFTER_MS - 1,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("replaces a handshake that never finished", () => {
    expect(
      mustReplaceSocket({
        readyState: CONNECTING,
        lastFrameAtMs: now - FRAME_STALE_AFTER_MS - 1,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("leaves a socket alone while frames — heartbeats included — keep landing", () => {
    expect(mustReplaceSocket({ readyState: OPEN, lastFrameAtMs: now - 10_000, nowMs: now })).toBe(
      false,
    );
    // Exactly on the window is still inside it.
    expect(
      mustReplaceSocket({
        readyState: OPEN,
        lastFrameAtMs: now - FRAME_STALE_AFTER_MS,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("does not fight the ordinary reconnect: a closed or absent socket is already owned", () => {
    for (const readyState of [CLOSING, CLOSED, null]) {
      expect(mustReplaceSocket({ readyState, lastFrameAtMs: 0, nowMs: now })).toBe(false);
    }
  });
});

describe("backoff", () => {
  it("stays inside (100ms, ceiling) at every attempt and every draw", () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      for (const random of [0, 0.001, 0.5, 0.999, 1]) {
        const delay = reconnectDelayMs(attempt, random);
        expect(delay).toBeGreaterThanOrEqual(100);
        expect(delay).toBeLessThanOrEqual(BACKOFF_CEILING_MS);
      }
    }
  });

  it("grows with the attempt until it reaches the ceiling", () => {
    expect(reconnectDelayMs(1, 1)).toBe(500);
    expect(reconnectDelayMs(2, 1)).toBe(1_000);
    expect(reconnectDelayMs(3, 1)).toBe(2_000);
    expect(reconnectDelayMs(10, 1)).toBe(BACKOFF_CEILING_MS);
  });
});

describe("asking for a new ticket", () => {
  it("asks every few consecutive failures, and never before the first", () => {
    expect(shouldRefreshTicket(0)).toBe(false);
    expect(shouldRefreshTicket(1)).toBe(false);
    expect(shouldRefreshTicket(REFRESH_EVERY_ATTEMPTS - 1)).toBe(false);
    expect(shouldRefreshTicket(REFRESH_EVERY_ATTEMPTS)).toBe(true);
    expect(shouldRefreshTicket(REFRESH_EVERY_ATTEMPTS + 1)).toBe(false);
    expect(shouldRefreshTicket(REFRESH_EVERY_ATTEMPTS * 2)).toBe(true);
  });
});
