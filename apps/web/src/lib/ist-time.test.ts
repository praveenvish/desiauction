import { describe, expect, it } from "vitest";

import { parseIstLocal, toIstLocal } from "./ist-time";

describe("a datetime-local value is India time", () => {
  it("reads 8 pm IST as 2:30 pm UTC, and back", () => {
    const moment = parseIstLocal("2026-10-04T20:00");
    expect(moment?.toISOString()).toBe("2026-10-04T14:30:00.000Z");
    expect(toIstLocal(new Date("2026-10-04T14:30:00Z"))).toBe("2026-10-04T20:00");
  });

  it("crosses midnight the way a clock in India does", () => {
    expect(parseIstLocal("2026-10-05T01:00")?.toISOString()).toBe("2026-10-04T19:30:00.000Z");
  });

  it("refuses anything that is not a real date and time", () => {
    for (const value of ["", "2026-10-04", "2026-02-31T20:00", "2026-10-04T25:00", "tomorrow"]) {
      expect(parseIstLocal(value)).toBeNull();
    }
  });
});
