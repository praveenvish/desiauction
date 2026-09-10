import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SPORTS } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { DEMO_SPORTS, validateDemoRequest, type DemoRequestInput } from "./demo-requests";

/**
 * What the public form will and will not accept. Every case here is one a real
 * person or a real bot produces: a number typed with spaces, a date in the
 * past, a source that arrived in a query string somebody edited.
 */

const NOW = new Date("2026-09-02T09:00:00.000Z");

const base: DemoRequestInput = {
  name: "Ravi Kumar",
  phone: "98765 43210",
  email: null,
  orgName: "Sunday Warriors PL",
  sport: "cricket",
  tournamentSize: "8-16",
  auctionOn: null,
  preferredWindow: "any",
  note: null,
  source: "schedule-demo",
  requestIp: "203.0.113.4",
};

function valid(overrides: Partial<DemoRequestInput> = {}) {
  const result = validateDemoRequest({ ...base, ...overrides }, NOW);
  if (!result.ok) {
    throw new Error(`expected valid, got ${result.field}: ${result.message}`);
  }
  return result.value;
}

describe("validateDemoRequest", () => {
  it("normalises the phone through the same parser sign-in uses", () => {
    expect(valid().phone).toBe("+919876543210");
    expect(valid({ phone: "+91 98765-43210" }).phone).toBe("+919876543210");
    expect(valid({ phone: "09876543210" }).phone).toBe("+919876543210");
  });

  it("refuses a number that is not an Indian mobile", () => {
    const result = validateDemoRequest({ ...base, phone: "12345" }, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe("phone");
  });

  it("treats an empty email as absent rather than invalid", () => {
    expect(valid({ email: "" }).email).toBeNull();
    expect(valid({ email: "  Ravi@Example.COM " }).email).toBe("ravi@example.com");
  });

  it("refuses an email that is present and malformed", () => {
    const result = validateDemoRequest({ ...base, email: "ravi@" }, NOW);
    expect(!result.ok && result.field).toBe("email");
  });

  it("accepts a blank auction date — most people have not fixed one", () => {
    expect(valid({ auctionOn: "" }).auctionOn).toBeNull();
    expect(valid({ auctionOn: "2026-10-15" }).auctionOn).toBe("2026-10-15");
  });

  it("refuses a date in the past, a date that does not exist, and one absurdly far off", () => {
    for (const bad of ["2020-01-01", "2026-02-31", "2099-01-01", "15/10/2026"]) {
      const result = validateDemoRequest({ ...base, auctionOn: bad }, NOW);
      expect(result.ok, `${bad} should be refused`).toBe(false);
      expect(!result.ok && result.field).toBe("auctionOn");
    }
  });

  it("accepts today, which is the boundary somebody in a hurry will hit", () => {
    expect(valid({ auctionOn: "2026-09-02" }).auctionOn).toBe("2026-09-02");
  });

  it("refuses a size or window outside the closed list", () => {
    expect(validateDemoRequest({ ...base, tournamentSize: "loads" }, NOW).ok).toBe(false);
    expect(validateDemoRequest({ ...base, preferredWindow: "3am" }, NOW).ok).toBe(false);
  });

  /*
   * THE SP-1 GATE'S ONLY INSTRUMENT (migration 0045). These tests exist to keep
   * one number honest: how many people asked for each sport. Everything below
   * is a way that number could quietly stop meaning anything.
   */
  it("accepts every sport the form offers", () => {
    for (const sport of DEMO_SPORTS) {
      expect(valid({ sport }).sport).toBe(sport);
    }
  });

  it("requires an answer — an unanswered select is not a silent 'cricket'", () => {
    const result = validateDemoRequest({ ...base, sport: "" }, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe("form");
  });

  it("refuses a tampered sport instead of folding it to 'other'", () => {
    // The contrast with `source` on the next test is deliberate and is the
    // whole design: a bad attribution is noise we can live with, a bad sport is
    // noise in the number the Phase 1 decision reads.
    expect(validateDemoRequest({ ...base, sport: "quidditch" }, NOW).ok).toBe(false);
    expect(validateDemoRequest({ ...base, sport: "<script>" }, NOW).ok).toBe(false);
    expect(validateDemoRequest({ ...base, sport: "Cricket" }, NOW).ok).toBe(false);
  });

  it("keeps the sport list independent of the sports the platform can run", () => {
    // core's registry knows cricket and nothing else. If this list is ever
    // wired to it, the form offers one option and measures nothing.
    expect(DEMO_SPORTS.length).toBeGreaterThan(SPORTS.length);
    for (const pack of SPORTS) {
      expect(DEMO_SPORTS).toContain(pack.key);
    }
  });

  /**
   * THE FORM OFFERS EXACTLY WHAT THE SERVER ACCEPTS.
   *
   * The two lists are written in different files and nothing held them
   * together, so they drifted twice: `table-tennis` was renamed `table_tennis`
   * in 0057 everywhere except the form, which meant choosing Table tennis was
   * REFUSED — the server rejects an unknown sport rather than folding it to
   * "other", deliberately, because this is the answer that gets counted. And
   * `box_cricket` was a valid answer nobody could give.
   *
   * Both failures are silent from the inside: the type system cannot see into
   * JSX option values, and every unit test here passes a value it made up.
   *
   * Read with readFileSync rather than grep — a file holding a literal control
   * byte is classified as binary and skipped in silence, so a grep-based
   * guardrail passes by refusing to look.
   */
  it("offers on the form exactly the sports the server will accept", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const form = readFileSync(
      resolve(here, "../../components/marketing/demo-request-form.tsx"),
      "utf8",
    );
    // The sport select only, so the source and size selects on the same page
    // cannot lend it their values.
    const select = /<Select label="Which sport\?"[\s\S]*?<\/Select>/.exec(form)?.[0];
    expect(select).toBeDefined();
    const offered = [...(select ?? "").matchAll(/<option value="([^"]*)"/g)]
      .map((match) => match[1] ?? "")
      .filter((value) => value !== "");
    expect([...offered].sort()).toEqual([...DEMO_SPORTS].sort());
  });

  it("records an unrecognised source as 'other' rather than losing the lead", () => {
    // The value rides a query string on a public page and lands in an admin
    // console. It must never travel as typed, and it must never cost us the
    // request either.
    expect(valid({ source: "<script>" }).source).toBe("other");
    expect(valid({ source: "pricing" }).source).toBe("pricing");
  });

  it("trims and caps the free text, and stores an empty note as absent", () => {
    expect(valid({ note: "   " }).note).toBeNull();
    expect(valid({ note: `  ${"x".repeat(3000)}  ` }).note).toHaveLength(2000);
  });

  it("refuses a name or tournament that is blank or absurd", () => {
    expect(validateDemoRequest({ ...base, name: " " }, NOW).ok).toBe(false);
    expect(validateDemoRequest({ ...base, orgName: "x" }, NOW).ok).toBe(false);
    expect(validateDemoRequest({ ...base, name: "x".repeat(200) }, NOW).ok).toBe(false);
  });
});
