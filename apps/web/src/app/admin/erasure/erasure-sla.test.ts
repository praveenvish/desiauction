import { describe, expect, it } from "vitest";

import { erasureDaysLeft, istDate } from "./erasure-sla";

// 2026-09-18 15:00 IST
const ASKED = Date.parse("2026-09-18T09:30:00Z");

describe("erasureDaysLeft", () => {
  it("counts a full week on the day it was asked", () => {
    expect(erasureDaysLeft(ASKED, Date.parse("2026-09-18T12:00:00Z"))).toBe(7);
  });

  it("is due on the seventh calendar day, whatever the hour", () => {
    expect(erasureDaysLeft(ASKED, Date.parse("2026-09-24T19:00:00Z"))).toBe(0); // 25th, 00:30 IST
    expect(erasureDaysLeft(ASKED, Date.parse("2026-09-25T17:00:00Z"))).toBe(0); // 25th, 22:30 IST
  });

  it("is overdue the morning after, before 24h periods would say so", () => {
    // 26th 08:28 IST: only 7.7 elapsed days, but the promise lapsed yesterday.
    expect(erasureDaysLeft(ASKED, Date.parse("2026-09-26T02:58:00Z"))).toBe(-1);
  });

  it("uses the India calendar, not UTC, for a late-evening request", () => {
    // 19:00Z on the 18th is already 00:30 on the 19th in India: due the 26th.
    const late = Date.parse("2026-09-18T19:00:00Z");
    expect(erasureDaysLeft(late, Date.parse("2026-09-25T06:00:00Z"))).toBe(1);
  });

  it("prints the India date the SLA counts from", () => {
    expect(istDate(Date.parse("2026-09-18T19:40:26Z"))).toBe("2026-09-19");
    expect(istDate(Date.parse("2026-09-18T09:30:00Z"))).toBe("2026-09-18");
  });
});
