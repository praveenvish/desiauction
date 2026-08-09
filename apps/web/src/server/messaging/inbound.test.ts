import { describe, expect, it } from "vitest";

import { classifyInbound, normaliseInboundNumber } from "./inbound";

/**
 * The classifier decides whether someone's opt-out is honoured or silently
 * dropped, so it is tested against what people actually send rather than
 * against the happy word.
 */
describe("classifyInbound", () => {
  it("recognises the universal keyword in any case", () => {
    for (const body of ["STOP", "stop", "Stop", "  STOP  "]) {
      expect(classifyInbound(body), body).toBe("stop");
    }
  });

  it("recognises what an annoyed person actually types", () => {
    for (const body of ["UNSUBSCRIBE", "unsub", "OPTOUT", "opt-out", "CANCEL", "end"]) {
      expect(classifyInbound(body), body).toBe("stop");
    }
  });

  it("survives the punctuation people add", () => {
    for (const body of ["STOP.", "STOP!", "stop!!!", "Stop,"]) {
      expect(classifyInbound(body), body).toBe("stop");
    }
  });

  it("takes an instruction that carries extra words", () => {
    expect(classifyInbound("STOP sending me these messages")).toBe("stop");
    expect(classifyInbound("stop please")).toBe("stop");
  });

  it("does NOT treat a mention of the word as an instruction", () => {
    // First word only. Someone writing about the auction is not opting out, and
    // silencing them would be a bug they could not see and we could not explain.
    expect(classifyInbound("please don't stop the auction")).toBe("unknown");
    expect(classifyInbound("when does registration stop?")).toBe("unknown");
  });

  it("recognises the way back in", () => {
    for (const body of ["START", "start", "UNSTOP", "subscribe", "RESUME", "yes"]) {
      expect(classifyInbound(body), body).toBe("start");
    }
  });

  it("ignores a message with no instruction in it", () => {
    for (const body of ["thanks", "ok", "who is this", "", "   "]) {
      expect(classifyInbound(body), JSON.stringify(body)).toBe("unknown");
    }
  });
});

/**
 * The number has to land in the same shape the suppression list is keyed by. A
 * STOP recorded against `919812345678` would never match a send addressed to
 * `+919812345678`, and the person would keep receiving messages having done
 * exactly what we told them to.
 */
describe("normaliseInboundNumber", () => {
  it("adds the country code to a bare Indian mobile", () => {
    expect(normaliseInboundNumber("9812345678")).toBe("+919812345678");
  });

  it("adds the plus to a number that already carries 91", () => {
    expect(normaliseInboundNumber("919812345678")).toBe("+919812345678");
  });

  it("leaves an already-E.164 number alone", () => {
    expect(normaliseInboundNumber("+919812345678")).toBe("+919812345678");
  });

  it("strips the punctuation operators send", () => {
    expect(normaliseInboundNumber(" 98123-45678 ")).toBe("+919812345678");
  });

  it("returns null rather than guessing at nothing", () => {
    expect(normaliseInboundNumber("")).toBeNull();
    expect(normaliseInboundNumber("   ")).toBeNull();
    expect(normaliseInboundNumber("abc")).toBeNull();
  });
});
