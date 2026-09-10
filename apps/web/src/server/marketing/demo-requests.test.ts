import { readdirSync, readFileSync } from "node:fs";
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
    // The registry names what the platform can RUN — twelve sports now. This
    // list names what somebody came here WANTING, so it must stay LARGER: wire
    // it to the registry and the question stops measuring the thing it exists
    // to measure, because it can no longer be asked about a sport we can't run.
    expect(DEMO_SPORTS.length).toBeGreaterThan(SPORTS.length);
    for (const pack of SPORTS) {
      expect(DEMO_SPORTS).toContain(pack.key);
    }
  });

  /**
   * NOBODY RETYPES THE LIST.
   *
   * The sports existed in five places — `DEMAND_SPORTS`, the form's `<option>`
   * values, the admin queue's badge words, the drizzle enum and the database
   * CHECK — and drifted twice in two days. `table_tennis` was renamed in 0057
   * everywhere except the form, so choosing Table tennis was REFUSED (the
   * server rejects an unknown sport rather than folding it to "other",
   * deliberately, because this is the answer that gets counted); `box_cricket`
   * was a valid answer nobody could give.
   *
   * Three of the five are now derived from `content/demand-sports.ts`, so they
   * cannot drift. The two below are SQL and cannot be derived, so they are read.
   *
   * Read with readFileSync rather than grep — a file holding a literal control
   * byte is classified as binary and skipped in silence, so a grep-based
   * guardrail passes by refusing to look.
   */
  const repoFile = (path: string): string =>
    readFileSync(resolve(fileURLToPath(new URL(".", import.meta.url)), path), "utf8");

  it("renders the form's sports from the list rather than restating them", () => {
    const form = repoFile("../../components/marketing/demo-request-form.tsx");
    // The sport select only, so the source and size selects on the same page
    // cannot lend it their values.
    const select = /<Select label="Which sport\?"[\s\S]*?<\/Select>/.exec(form)?.[0];
    expect(select).toBeDefined();
    /*
     * The ONLY literal option is the empty "Choose a sport" placeholder, which
     * is not a sport. A hardcoded sport here is the exact defect that shipped —
     * a second copy of the list that looks right and is one rename behind.
     */
    const literal = [...(select ?? "").matchAll(/<option value="([^"]*)"/g)]
      .map((match) => match[1] ?? "")
      .filter((value) => value !== "");
    expect(literal).toEqual([]);
    expect(select).toContain("DEMAND_SPORTS.map");
  });

  it("builds the admin queue's badge words from the list rather than restating them", () => {
    /*
     * The third copy, and it was stale in exactly the way the form was — still
     * keyed on `table-tennis`, never heard of `box_cricket` or `battle_royale`.
     * It fails quietly: an unknown key falls through to the raw string, so the
     * operator counting demand reads `table_tennis` in a row of ordinary words
     * and has no reason to think anything is wrong. That operator's count is
     * what decides which pack gets written next.
     */
    const panel = withoutComments(repoFile("../../app/admin/demos/demo-queue-panel.tsx"));
    const map = /const SPORT_WORDS[\s\S]*?\n\n/.exec(panel)?.[0];
    expect(map, "SPORT_WORDS is not shaped the way this test reads").toBeDefined();
    expect(map).toContain("DEMAND_SPORTS.map");
    expect([...(map ?? "").matchAll(/^\s*"?([a-z_]+)"?:\s*"/gm)].map((m) => m[1])).toEqual([]);
  });

  /**
   * Comments are prose and prose may say anything.
   *
   * The schema's own note beside this column explains that an organizer whose
   * sport is missing "picks \"cricket\" and the demand signal is lost" — a
   * sentence about the column, quoting a key. Read raw, that quotation counts
   * as a second cricket and fails the file for describing itself accurately.
   * Same trap `sports/pack-contract.test.ts` fell into with SQL.
   */
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  it("holds the drizzle enum to the list", () => {
    const schema = withoutComments(repoFile("../../../../../packages/db/src/schema.ts"));
    // The `sport` column of demo_requests, not any other text-with-enum column.
    const column = /sport:\s*text\("sport",\s*\{[\s\S]*?\}\)/.exec(schema)?.[0];
    expect(column, "demo_requests.sport is not shaped the way this test reads").toBeDefined();
    const values = [...(column ?? "").matchAll(/"([a-z_]+)"/g)]
      .map((match) => match[1] ?? "")
      .filter((value) => value !== "sport");
    expect([...values].sort()).toEqual([...DEMO_SPORTS].sort());
  });

  it("holds the database CHECK to the list", () => {
    /*
     * The LAST migration to define the constraint wins — it has been rewritten
     * twice (0057 renamed a key, 0060 added battle royale), and reading the
     * first one would hold the app to a list the database stopped using.
     */
    const dir = resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../../../../packages/db/migrations",
    );
    const defining = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) =>
        readFileSync(resolve(dir, name), "utf8").includes("demo_requests_sport_check"),
      );
    expect(defining.length, "no migration defines demo_requests_sport_check").toBeGreaterThan(0);
    const latest = readFileSync(resolve(dir, defining[defining.length - 1] ?? ""), "utf8")
      // SQL has comments, and the migrations here are heavily commented by
      // design — an example list inside an explanation would be read as live.
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ");
    const check = /demo_requests_sport_check[\s\S]*?IN \(([\s\S]*?)\)/.exec(latest)?.[1];
    expect(check, "the CHECK is not shaped the way this test reads").toBeDefined();
    const values = [...(check ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? "");
    expect([...values].sort()).toEqual([...DEMO_SPORTS].sort());
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
