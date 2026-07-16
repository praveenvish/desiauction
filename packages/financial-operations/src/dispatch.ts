/**
 * The Dispatch aggregate (IP-6_ARCHITECTURE §7/§8.3): one per delivery
 * attempt, one stream, one reducer — the frozen Payment aggregate's pattern on
 * the delivery plane. Pure.
 *
 * `failed` and `confirmed` are terminal; a retry is a NEW dispatch (nothing
 * sent is ever unsent — doc 47/invariant 30). Provider adapters arrive with
 * M-IP6-3; the aggregate, its queue mechanics and its recovery are foundation.
 */

import { str, type FinopsEventEnvelope, type FinopsReplayFailure } from "./events";

export type DispatchChannel = "in-app" | "email" | "whatsapp" | "org-webhook";

export const DISPATCH_CHANNELS: readonly DispatchChannel[] = [
  "in-app",
  "email",
  "whatsapp",
  "org-webhook",
];

export function isDispatchChannel(value: string): value is DispatchChannel {
  return (DISPATCH_CHANNELS as readonly string[]).includes(value);
}

export type DispatchStatus = "requested" | "sent" | "confirmed" | "failed";

export interface DispatchProjection {
  status: DispatchStatus;
  dispatchId: string;
  orgId: string;
  channel: DispatchChannel;
  recipientRef: string;
  templateId: string;
  templateVersion: string;
  /** What is being delivered — a document id or a notice kind. */
  subjectRef: string;
  providerRef: string | null;
  providerEventRef: string | null;
  failureCode: string | null;
  requestedBy: string;
  recoveries: number;
  lastSeq: number;
  eventCount: number;
}

export type DispatchReplayResult =
  { ok: true; projection: DispatchProjection } | FinopsReplayFailure;

export function replayDispatch(events: readonly FinopsEventEnvelope[]): DispatchReplayResult {
  let projection: DispatchProjection | null = null;

  for (const event of events) {
    const fail = (reason: FinopsReplayFailure["reason"]): DispatchReplayResult => ({
      ok: false,
      atSeq: event.seq,
      reason,
    });

    if (projection === null) {
      if (event.seq !== 1) {
        return fail("sequence_gap");
      }
      if (event.type !== "DispatchRequested") {
        return fail("unknown_dispatch");
      }
      const dispatchId = str(event.payload, "dispatchId");
      const orgId = str(event.payload, "orgId");
      const channelRaw = str(event.payload, "channel");
      const recipientRef = str(event.payload, "recipientRef");
      const templateId = str(event.payload, "templateId");
      const templateVersion = str(event.payload, "templateVersion");
      const subjectRef = str(event.payload, "subjectRef");
      if (
        dispatchId === null ||
        dispatchId !== event.streamId ||
        orgId === null ||
        channelRaw === null ||
        !isDispatchChannel(channelRaw) ||
        recipientRef === null ||
        templateId === null ||
        templateVersion === null ||
        subjectRef === null
      ) {
        return fail("malformed_dispatch");
      }
      projection = {
        status: "requested",
        dispatchId,
        orgId,
        channel: channelRaw,
        recipientRef,
        templateId,
        templateVersion,
        subjectRef,
        providerRef: null,
        providerEventRef: null,
        failureCode: null,
        requestedBy: event.actor,
        recoveries: 0,
        lastSeq: 1,
        eventCount: 1,
      };
      continue;
    }

    if (event.seq !== projection.lastSeq + 1) {
      return fail("sequence_gap");
    }
    const state = projection;

    switch (event.type) {
      case "DispatchRequested":
        return fail("illegal_replayed_transition");

      case "DispatchSent": {
        if (state.status !== "requested") {
          return fail("illegal_replayed_transition");
        }
        const providerRef = str(event.payload, "providerRef");
        if (providerRef === null) {
          return fail("malformed_dispatch");
        }
        state.status = "sent";
        state.providerRef = providerRef;
        break;
      }

      case "DispatchConfirmed": {
        // Provider truth where the channel offers it — only a SENT dispatch
        // can be confirmed, and confirmation is terminal.
        if (state.status !== "sent") {
          return fail("illegal_replayed_transition");
        }
        const providerEventRef = str(event.payload, "providerEventRef");
        if (providerEventRef === null) {
          return fail("malformed_dispatch");
        }
        state.status = "confirmed";
        state.providerEventRef = providerEventRef;
        break;
      }

      case "DispatchFailed": {
        // Legal from `requested` (send attempts exhausted) and from `sent`
        // (provider bounce). Terminal: retry = a NEW dispatch aggregate.
        if (state.status !== "requested" && state.status !== "sent") {
          return fail("illegal_replayed_transition");
        }
        const code = str(event.payload, "code");
        if (code === null) {
          return fail("malformed_dispatch");
        }
        state.status = "failed";
        state.failureCode = code;
        break;
      }

      case "DispatchRecovered": {
        state.recoveries += 1;
        break;
      }

      default:
        return fail("unknown_event_type");
    }

    state.lastSeq = event.seq;
    state.eventCount += 1;
  }

  if (projection === null) {
    return { ok: false, atSeq: 0, reason: "unknown_dispatch" };
  }
  return { ok: true, projection };
}
