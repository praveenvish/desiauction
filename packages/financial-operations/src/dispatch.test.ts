import { describe, expect, it } from "vitest";

import {
  decideMarkDispatchFailed,
  decideMarkDispatchSent,
  decideRequestDispatch,
} from "./commands";
import { replayDispatch } from "./dispatch";
import { envelope } from "./testing";
import type { FinopsEventEnvelope } from "./events";

const DISPATCH = "01DIS00000000000000000000A";
const ORG = "01ORG00000000000000000000A";

function requested(): FinopsEventEnvelope[] {
  return [
    envelope("dispatch", DISPATCH, 1, "DispatchRequested", {
      dispatchId: DISPATCH,
      orgId: ORG,
      channel: "email",
      recipientRef: "owner:01TEAM0000000000000000000A",
      templateId: "receipt-issued",
      templateVersion: "v1",
      subjectRef: "doc:01DOC000000000000000000001",
    }),
  ];
}

const sent = envelope("dispatch", DISPATCH, 2, "DispatchSent", { providerRef: "msg_123" });
const confirmed = envelope("dispatch", DISPATCH, 3, "DispatchConfirmed", {
  providerEventRef: "evt_456",
});
const failed = envelope("dispatch", DISPATCH, 2, "DispatchFailed", { code: "provider_5xx" });

describe("Dispatch aggregate", () => {
  it("requested → sent → confirmed; deterministic double fold", () => {
    const events = [...requested(), sent, confirmed];
    const first = replayDispatch(events);
    const second = replayDispatch(events);
    if (!first.ok || !second.ok) {
      throw new Error("fold failed");
    }
    expect(first.projection.status).toBe("confirmed");
    expect(first.projection.providerRef).toBe("msg_123");
    expect(JSON.stringify(first.projection)).toBe(JSON.stringify(second.projection));
  });

  it("terminal means terminal: nothing folds after confirmed or failed (retry = NEW dispatch)", () => {
    expect(
      replayDispatch([
        ...requested(),
        sent,
        confirmed,
        envelope("dispatch", DISPATCH, 4, "DispatchFailed", { code: "late" }),
      ]),
    ).toEqual({ ok: false, atSeq: 4, reason: "illegal_replayed_transition" });
    expect(
      replayDispatch([
        ...requested(),
        failed,
        envelope("dispatch", DISPATCH, 3, "DispatchSent", { providerRef: "again" }),
      ]),
    ).toEqual({ ok: false, atSeq: 3, reason: "illegal_replayed_transition" });
  });

  it("confirmation requires a prior send; a bounce after send folds to failed", () => {
    const confirmedWithoutSend = envelope("dispatch", DISPATCH, 2, "DispatchConfirmed", {
      providerEventRef: "evt_456",
    });
    expect(replayDispatch([...requested(), confirmedWithoutSend])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "illegal_replayed_transition",
    });
    const bounced = replayDispatch([
      ...requested(),
      sent,
      envelope("dispatch", DISPATCH, 3, "DispatchFailed", { code: "bounce" }),
    ]);
    if (!bounced.ok) {
      throw new Error("fold failed");
    }
    expect(bounced.projection.status).toBe("failed");
    expect(bounced.projection.failureCode).toBe("bounce");
  });

  it("fails closed: unknown types, gaps, malformed payloads, wrong genesis, bad channel", () => {
    expect(replayDispatch([sent])).toEqual({ ok: false, atSeq: 2, reason: "sequence_gap" });
    expect(
      replayDispatch([...requested(), envelope("dispatch", DISPATCH, 2, "DispatchForged", {})]),
    ).toEqual({ ok: false, atSeq: 2, reason: "unknown_event_type" });
    expect(
      replayDispatch([...requested(), envelope("dispatch", DISPATCH, 2, "DispatchSent", {})]),
    ).toEqual({ ok: false, atSeq: 2, reason: "malformed_dispatch" });
    const badChannel = envelope("dispatch", DISPATCH, 1, "DispatchRequested", {
      ...requested()[0]?.payload,
      channel: "pigeon",
    });
    expect(replayDispatch([badChannel])).toEqual({
      ok: false,
      atSeq: 1,
      reason: "malformed_dispatch",
    });
  });

  it("command guards mirror the machine", () => {
    expect(
      decideRequestDispatch(null, {
        dispatchId: DISPATCH,
        orgId: ORG,
        channel: "email",
        recipientRef: "",
        templateId: "t",
        templateVersion: "v1",
        subjectRef: "s",
      }),
    ).toEqual({ ok: false, reason: "dispatch_incomplete" });
    expect(decideMarkDispatchSent(null, "ref")).toEqual({ ok: false, reason: "dispatch_missing" });
    const fold = replayDispatch([...requested(), sent, confirmed]);
    if (!fold.ok) {
      throw new Error("fold failed");
    }
    expect(decideMarkDispatchFailed(fold.projection, "late")).toEqual({
      ok: false,
      reason: "dispatch_terminal",
    });
  });
});
