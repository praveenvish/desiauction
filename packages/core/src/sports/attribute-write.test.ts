import { describe, expect, it } from "vitest";

import { CRICKET } from "./cricket";
import { FOOTBALL } from "./football";
import { attributeOptions, describeAttributes, splitAttributeWrite } from "./index";

/**
 * THE COLUMN NOTHING WROTE TO.
 *
 * `registrations.attributes` is documented in the schema as the home of "every
 * sport added from football on", and the pack contract says the same. No code
 * path anywhere in the product wrote a single value into it, and the public
 * registration form asked every registrant — footballer, raider, keeper — for a
 * batting style and a bowling style in cricket's own words. These are the tests
 * for the three functions that close that gap: what a form should offer, where
 * an answer belongs, and how a stored answer is read back.
 */

describe("what a sport asks, as plain data", () => {
  it("gives cricket its two styles, and says they live in columns", () => {
    const options = attributeOptions("cricket");
    expect(options.map((option) => option.key)).toEqual(["batting_style", "bowling_style"]);
    expect(options.every((option) => option.storage === "column")).toBe(true);
    expect(options[0]?.column).toBe("batting_style");
    expect(options[0]?.options.length).toBeGreaterThan(0);
  });

  it("gives football its own question, and says it lives in json", () => {
    const options = attributeOptions("football");
    expect(options.map((option) => option.key)).toEqual(["preferred_foot"]);
    expect(options[0]?.storage).toBe("json");
    expect(options[0]?.column).toBeNull();
    expect(options[0]?.options.map((option) => option.key)).toEqual(["right", "left", "both"]);
  });

  /* The whole point: a football form must not offer cricket's questions. */
  it("never offers one sport's questions for another", () => {
    const football = attributeOptions("football").map((option) => option.key);
    expect(football).not.toContain("batting_style");
    expect(football).not.toContain("bowling_style");
  });

  /* Five of the twelve packs declare nothing, and an empty list is the correct
     answer for them — not a reason to fall back to cricket's two. */
  it("returns nothing for a sport that asks nothing", () => {
    expect(attributeOptions("kabaddi")).toEqual([]);
    expect(attributeOptions("basketball")).toEqual([]);
  });
});

describe("where an answer belongs", () => {
  it("routes cricket's answers to their own columns and nothing to json", () => {
    const write = splitAttributeWrite(CRICKET, {
      batting_style: "right_hand",
      bowling_style: "right_arm_fast",
    });
    expect(write.columns).toEqual({
      batting_style: "right_hand",
      bowling_style: "right_arm_fast",
    });
    expect(write.json).toEqual({});
  });

  it("routes football's answer to json and nothing to a column", () => {
    const write = splitAttributeWrite(FOOTBALL, { preferred_foot: "left" });
    expect(write.columns).toEqual({});
    expect(write.json).toEqual({ preferred_foot: "left" });
  });

  /* A stale localStorage draft, a hand-edited request, a season whose sport was
     changed underneath it — all arrive here, and none of them may reach a row. */
  it("drops a value from another sport rather than storing it", () => {
    const write = splitAttributeWrite(FOOTBALL, {
      batting_style: "right_hand",
      preferred_foot: "right",
    });
    expect(write.columns).toEqual({});
    expect(write.json).toEqual({ preferred_foot: "right" });
  });

  it("drops a value the pack does not list", () => {
    expect(splitAttributeWrite(FOOTBALL, { preferred_foot: "sideways" }).json).toEqual({});
  });

  it("treats an empty answer as no answer", () => {
    expect(splitAttributeWrite(FOOTBALL, { preferred_foot: "" }).json).toEqual({});
  });
});

describe("reading an answer back", () => {
  it("labels a stored value in the sport's own words", () => {
    expect(describeAttributes("football", { preferred_foot: "left" })).toEqual([
      { key: "preferred_foot", label: "Preferred foot", value: "Left footed" },
    ]);
  });

  /* A row written under one sport and read under another shows nothing rather
     than printing a token the reader cannot interpret. */
  it("shows nothing when the season's pack cannot explain the value", () => {
    expect(describeAttributes("cricket", { preferred_foot: "left" })).toEqual([]);
    expect(describeAttributes("football", { preferred_foot: "sideways" })).toEqual([]);
  });

  it("ignores absent, empty and non-string values", () => {
    expect(describeAttributes("football", {})).toEqual([]);
    expect(describeAttributes("football", { preferred_foot: "" })).toEqual([]);
    expect(describeAttributes("football", { preferred_foot: 7 })).toEqual([]);
  });

  /* The round trip the product actually performs: a form's answers, split for
     storage, then read back for a player card. */
  it("survives the round trip a registration makes", () => {
    const write = splitAttributeWrite(FOOTBALL, { preferred_foot: "both" });
    expect(describeAttributes("football", write.json)).toEqual([
      { key: "preferred_foot", label: "Preferred foot", value: "Both feet" },
    ]);
  });
});
