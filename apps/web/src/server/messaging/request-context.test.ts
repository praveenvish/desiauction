import { describe, expect, it } from "vitest";

import { momentWords, requestDetails } from "./request-context";

const AT = new Date("2026-09-28T14:12:00Z"); // 7:42 pm IST

describe("where and when, said out loud", () => {
  it("says the moment in IST, in the reader's language", () => {
    expect(momentWords(AT, "en")).toBe("Mon 28 Sep, 7:42 pm IST");
    expect(momentWords(AT, "hi")).toMatch(/^सोम, 28 .+ 7:42 pm IST$/);
  });

  it("names the device only when it knows it", () => {
    expect(requestDetails({ device: "Chrome on macOS", at: AT }, "code", "en")).toEqual([
      ["Device", "Chrome on macOS"],
      ["Requested", "Mon 28 Sep, 7:42 pm IST"],
    ]);
    expect(requestDetails({ device: null, at: AT }, "change", "en")).toEqual([
      ["Changed", "Mon 28 Sep, 7:42 pm IST"],
    ]);
    expect(requestDetails({ device: "Safari on iPhone", at: AT }, "change", "hi")[0]).toEqual([
      "डिवाइस",
      "Safari on iPhone",
    ]);
  });
});
