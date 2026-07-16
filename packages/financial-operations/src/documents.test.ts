import type { SettlementEventEnvelope } from "@desiauction/settlement";
import { describe, expect, it } from "vitest";

import {
  correctionQuote,
  decideIssueDocument,
  formattedNumber,
  invoiceQuote,
  profileAt,
  receiptQuote,
  type DocumentQuote,
} from "./documents";
import { envelopes } from "./testing";
import { decideDeclareProfile } from "./commands";
import { replayProfile, type ProfileProjection } from "./profile";
import { replaySeries, type SeriesProjection } from "./series";
import type { FinopsEventEnvelope } from "./events";

// 2023-11-14T18:30Z == 2023-11-15 00:00 IST → FY 2023-24. Every settlement
// fixture below lives on this instant so fiscal legality is exercised exactly.
const AT = Date.parse("2023-11-14T18:30:00.000Z");
const PAYMENT = "01PAY00000000000000000000A";
const CASE = "01CAS00000000000000000000A";
const TEAM = "01TEAM0000000000000000000A";
const ORG = "01ORG00000000000000000000A";
const SERIES = "01SER00000000000000000000A";

/** A deterministic test digest — the domain is indifferent to the algorithm. */
const digest = (bytes: string): string => `d${String(bytes.length)}:${bytes.slice(0, 8)}`;

function settle(
  streamType: "payment" | "case",
  streamId: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): SettlementEventEnvelope {
  return {
    streamType,
    streamId,
    seq,
    type,
    atMs: AT + seq,
    actor: "01OFFICER00000000000000000",
    correlationId: `01CORR${String(seq).padStart(20, "0")}`,
    commandId: `01CMD${String(seq).padStart(21, "0")}`,
    payload,
  };
}

function paymentStream(refunded = false): SettlementEventEnvelope[] {
  const events = [
    settle("payment", PAYMENT, 1, "PaymentInitiated", {
      paymentId: PAYMENT,
      caseId: CASE,
      teamId: TEAM,
      method: "manual:cash",
      amount: 4_000_000,
    }),
    settle("payment", PAYMENT, 2, "PaymentCaptured", {
      amount: 4_000_000,
      attestedBy: "01OFFICER00000000000000000",
      evidenceRef: "cash-book-17",
    }),
  ];
  if (refunded) {
    events.push(
      settle("payment", PAYMENT, 3, "PaymentRefunded", {
        amount: 1_000_000,
        reason: "overcharge returned",
      }),
    );
  }
  return events;
}

function caseStream(): SettlementEventEnvelope[] {
  return [
    settle("case", CASE, 1, "CaseOpened", {
      caseId: CASE,
      auctionId: "01AUC00000000000000000000A",
      competitionId: "01COMP0000000000000000000A",
      basis: "committed",
      sourceEventCount: 20,
      sourceDigest: "src",
    }),
    settle("case", CASE, 2, "CaseVerified", {
      foldDigest: "fold",
      sourceEventCount: 20,
      sourceDigest: "src",
      teamCount: 1,
      totalCommitted: 4_000_000,
    }),
    settle("case", CASE, 3, "ObligationsComputed", {
      items: [{ teamId: TEAM, amount: 4_000_000 }],
    }),
    settle("case", CASE, 4, "ObligationWaived", {
      teamId: TEAM,
      amount: 500_000,
      reason: "sponsor covered",
    }),
  ];
}

function profileOf(posture: "none" | "gst-registered" = "none"): {
  profile: ProfileProjection;
  events: FinopsEventEnvelope[];
} {
  const decision = decideDeclareProfile(null, {
    orgId: ORG,
    legalName: "Gully Trust",
    posture,
    ...(posture === "gst-registered" ? { gstin: "27AAPFU0939F1ZV" } : {}),
  });
  if (!decision.ok) {
    throw new Error(decision.reason);
  }
  const events = envelopes(decision.events);
  const fold = replayProfile(events);
  if (!fold.ok) {
    throw new Error(fold.reason);
  }
  return { profile: fold.projection, events };
}

function seriesOf(kind: string, fy = "2023-24"): SeriesProjection {
  const fold = replaySeries(
    envelopes([
      {
        streamType: "series",
        streamId: SERIES,
        type: "SeriesOpened",
        payload: { seriesId: SERIES, orgId: ORG, kind, fy, prefix: "RCT" },
      },
    ]),
  );
  if (!fold.ok) {
    throw new Error(fold.reason);
  }
  return fold.projection;
}

function issueInput(quote: DocumentQuote, overrides: Record<string, unknown> = {}) {
  const { profile } = profileOf();
  return {
    docId: "01DOC000000000000000000001",
    party: { type: "team", id: TEAM, label: "Tigers" },
    quote,
    profile,
    profileSeq: 1,
    watermark: { [quote.sourceKey]: quote.sourceSeq },
    ...overrides,
  };
}

describe("quotes — settlement facts read off the FROZEN folds, never supplied", () => {
  it("receiptQuote quotes the capture exactly: amount, provenance, fiscal date, party", () => {
    const quoted = receiptQuote(paymentStream());
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) {
      return;
    }
    expect(quoted.quote.amount).toBe(4_000_000);
    expect(quoted.quote.sourceRef).toBe(`payment:${PAYMENT}:2`);
    expect(quoted.quote.sourceDate).toBe("2023-11-15");
    expect(quoted.quote.partyId).toBe(TEAM);
    expect(quoted.quote.lines[0]?.provenance).toEqual({ stream: `payment:${PAYMENT}`, seq: 2 });
  });

  it("an uncaptured or unfoldable payment can never be receipted", () => {
    const uncaptured = receiptQuote(paymentStream().slice(0, 1));
    expect(uncaptured).toEqual({ ok: false, reason: "payment_not_captured" });
    const stream = paymentStream();
    const initiated = stream[0];
    const captured = stream[1];
    if (initiated === undefined || captured === undefined) {
      throw new Error("fixture");
    }
    const gapped = receiptQuote([initiated, { ...captured, seq: 5 }]);
    expect(gapped).toEqual({ ok: false, reason: "source_unfoldable" });
  });

  it("invoiceQuote quotes the COMPUTED obligation; unknown teams are refused", () => {
    const quoted = invoiceQuote(caseStream(), TEAM);
    expect(quoted.ok).toBe(true);
    if (quoted.ok) {
      expect(quoted.quote.amount).toBe(4_000_000);
      expect(quoted.quote.sourceRef).toBe(`case:${CASE}:3:${TEAM}`);
      expect(quoted.quote.kind).toBe("tax-invoice");
    }
    expect(invoiceQuote(caseStream(), "01TEAMUNKNOWN0000000000000")).toEqual({
      ok: false,
      reason: "obligation_unknown",
    });
  });

  it("correctionQuote accepts only COMPENSATING causes (refund, waiver)", () => {
    const refund = correctionQuote(paymentStream(true), 3);
    expect(refund.ok).toBe(true);
    if (refund.ok) {
      expect(refund.quote.amount).toBe(1_000_000);
      expect(refund.quote.sourceRef).toBe(`payment:${PAYMENT}:3`);
    }
    // A capture is not a compensation — quoting it as one is refused.
    expect(correctionQuote(paymentStream(true), 2)).toEqual({
      ok: false,
      reason: "cause_not_compensating",
    });
    const waiver = correctionQuote(caseStream(), 4);
    expect(waiver.ok).toBe(true);
    if (waiver.ok) {
      expect(waiver.quote.amount).toBe(500_000);
      expect(waiver.quote.sourceRef).toBe(`case:${CASE}:4:${TEAM}`);
    }
  });
});

describe("decideIssueDocument — validates everything, computes nothing", () => {
  const quote = (): DocumentQuote => {
    const quoted = receiptQuote(paymentStream());
    if (!quoted.ok) {
      throw new Error(quoted.reason);
    }
    return quoted.quote;
  };

  it("issues densely into the lawful lane, and the emitted event FOLDS through the frozen reducer", () => {
    const series = seriesOf("receipt");
    const decision = decideIssueDocument(series, issueInput(quote()), digest);
    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      return;
    }
    const event = decision.events[0];
    if (event === undefined) {
      throw new Error("no event");
    }
    expect(event.type).toBe("DocumentIssued");
    expect(event.payload["number"]).toBe(1);
    expect(event.payload["amount"]).toBe(4_000_000);
    expect(typeof event.payload["contentDigest"]).toBe("string");

    // THE ROUND TRIP: the M-IP6-1 reducer accepts this milestone's emission.
    const streamEvents = [
      ...envelopes([
        {
          streamType: "series" as const,
          streamId: SERIES,
          type: "SeriesOpened",
          payload: { seriesId: SERIES, orgId: ORG, kind: "receipt", fy: "2023-24", prefix: "RCT" },
        },
      ]),
      ...envelopes([event], { startSeq: 2 }),
    ];
    const folded = replaySeries(streamEvents);
    expect(folded.ok).toBe(true);
    if (folded.ok) {
      expect(folded.projection.documents[0]?.number).toBe(1);
      expect(folded.projection.documents[0]?.amount).toBe(4_000_000);
    }
  });

  it("RENDER DETERMINISM: the same inputs render identical bytes and digest, twice", () => {
    const series = seriesOf("receipt");
    const input = issueInput(quote());
    const first = decideIssueDocument(series, input, digest);
    const second = decideIssueDocument(series, input, digest);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("series legality: closed lanes, foreign kinds and missing lanes refuse", () => {
    expect(decideIssueDocument(null, issueInput(quote()), digest)).toEqual({
      ok: false,
      reason: "series_missing",
    });
    const closed = { ...seriesOf("receipt"), status: "closed" as const };
    expect(decideIssueDocument(closed, issueInput(quote()), digest)).toEqual({
      ok: false,
      reason: "series_closed",
    });
    expect(decideIssueDocument(seriesOf("tax-invoice"), issueInput(quote()), digest)).toEqual({
      ok: false,
      reason: "series_kind_mismatch",
    });
  });

  it("fiscal legality: the SOURCE FACT's year must be the series' year", () => {
    const wrongYear = seriesOf("receipt", "2024-25");
    expect(decideIssueDocument(wrongYear, issueInput(quote()), digest)).toEqual({
      ok: false,
      reason: "fiscal_year_mismatch",
    });
  });

  it("watermark coverage: a document may not quote history the org has not consumed", () => {
    const series = seriesOf("receipt");
    const behind = issueInput(quote(), { watermark: { [`payment:${PAYMENT}`]: 1 } });
    expect(decideIssueDocument(series, behind, digest)).toEqual({
      ok: false,
      reason: "watermark_behind_source",
    });
    const empty = issueInput(quote(), { watermark: {} });
    expect(decideIssueDocument(series, empty, digest)).toEqual({
      ok: false,
      reason: "watermark_behind_source",
    });
  });

  it("ONE CAUSE, ONE DOCUMENT: a second issue for the same settlement source refuses", () => {
    const series = seriesOf("receipt");
    const first = decideIssueDocument(series, issueInput(quote()), digest);
    if (!first.ok) {
      throw new Error(first.reason);
    }
    const streamEvents = [
      ...envelopes([
        {
          streamType: "series" as const,
          streamId: SERIES,
          type: "SeriesOpened",
          payload: { seriesId: SERIES, orgId: ORG, kind: "receipt", fy: "2023-24", prefix: "RCT" },
        },
      ]),
      ...envelopes(first.events, { startSeq: 2 }),
    ];
    const folded = replaySeries(streamEvents);
    if (!folded.ok) {
      throw new Error(folded.reason);
    }
    expect(
      decideIssueDocument(
        folded.projection,
        issueInput(quote(), { docId: "01DOC000000000000000000002" }),
        digest,
      ),
    ).toEqual({ ok: false, reason: "duplicate_document_source" });
  });

  it("a GST-REGISTERED issuer gets NO invoice until decomposition is authorized", () => {
    const invoice = invoiceQuote(caseStream(), TEAM);
    if (!invoice.ok) {
      throw new Error(invoice.reason);
    }
    const registered = profileOf("gst-registered").profile;
    const refused = decideIssueDocument(
      seriesOf("tax-invoice"),
      issueInput(invoice.quote, { profile: registered }),
      digest,
    );
    expect(refused).toEqual({ ok: false, reason: "tax_decomposition_not_available" });
    // An UNREGISTERED issuer's dues bill is lawful.
    const allowed = decideIssueDocument(seriesOf("tax-invoice"), issueInput(invoice.quote), digest);
    expect(allowed.ok).toBe(true);
  });

  it("corrections demand linkage, a reason, and the correction lane", () => {
    const refund = correctionQuote(paymentStream(true), 3);
    if (!refund.ok) {
      throw new Error(refund.reason);
    }
    const lane = seriesOf("correction");
    expect(decideIssueDocument(lane, issueInput(refund.quote), digest)).toEqual({
      ok: false,
      reason: "corrects_required",
    });
    expect(
      decideIssueDocument(
        lane,
        issueInput(refund.quote, { corrects: "01DOC000000000000000000001", reason: " " }),
        digest,
      ),
    ).toEqual({ ok: false, reason: "reason_required" });
    const issued = decideIssueDocument(
      lane,
      issueInput(refund.quote, { corrects: "01DOC000000000000000000001", reason: "refund given" }),
      digest,
    );
    expect(issued.ok).toBe(true);
    if (issued.ok) {
      expect(issued.events[0]?.type).toBe("CorrectionIssued");
    }
  });

  it("party integrity: the named party must be the settlement fact's party", () => {
    const series = seriesOf("receipt");
    const wrongParty = issueInput(quote(), {
      party: { type: "team", id: "01TEAMOTHER000000000000000", label: "Lions" },
    });
    expect(decideIssueDocument(series, wrongParty, digest)).toEqual({
      ok: false,
      reason: "party_mismatch",
    });
  });
});

describe("rendering helpers", () => {
  it("formattedNumber is dense, padded and derived", () => {
    expect(formattedNumber("RCT", "2023-24", 7)).toBe("RCT/2023-24/000007");
  });

  it("profileAt folds the PREFIX — the profile as it stood at the pinned seq", () => {
    const { events } = profileOf();
    const at1 = profileAt(events, 1);
    expect(at1?.legalName).toBe("Gully Trust");
    expect(profileAt(events, 0)).toBeNull();
  });
});
