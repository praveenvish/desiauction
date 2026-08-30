import { describe, expect, it } from "vitest";

import {
  IST_OFFSET_MINUTES,
  dayLabel,
  deriveSlots,
  istDayKey,
  istInstant,
  timeLabel,
  weekdayOf,
  type AvailabilityWindow,
} from "./demo-slots";

/**
 * The slot derivation is the one piece of DEMO-1 with real arithmetic in it,
 * and every awkward case is a boundary: a day that starts in one UTC date and
 * ends in another, a window shorter than its slot, a booking that should
 * subtract exactly one time and leave its neighbours, a lead time that eats the
 * front of today. All of it is pure, so none of it needs a database or a clock.
 */

const evening = (weekday: number): AvailabilityWindow => ({
  weekday,
  startMinute: 19 * 60,
  endMinute: 21 * 60,
  slotMinutes: 30,
  effectiveFrom: null,
  effectiveTo: null,
});

/** Wednesday 2026-09-02, 09:00 IST — well before any evening window. */
const WED_MORNING = new Date("2026-09-02T03:30:00.000Z");

describe("IST conversion", () => {
  it("puts the offset where the calendar actually is", () => {
    expect(IST_OFFSET_MINUTES).toBe(330);
  });

  it("keeps late-evening IST inside the SAME IST day, not the next UTC one", () => {
    // 23:30 IST on the 2nd is 18:00Z on the 2nd — but 00:30 IST on the 3rd is
    // 19:00Z on the 2nd, and a naive UTC read would file it under the 2nd.
    expect(istDayKey(new Date("2026-09-02T19:00:00.000Z"))).toBe("2026-09-03");
    expect(istDayKey(new Date("2026-09-02T18:00:00.000Z"))).toBe("2026-09-02");
  });

  it("round-trips a day key and a minute back to the same instant", () => {
    const instant = istInstant("2026-09-02", 19 * 60);
    expect(instant.toISOString()).toBe("2026-09-02T13:30:00.000Z");
    expect(istDayKey(instant)).toBe("2026-09-02");
  });

  it("labels the weekday of an IST day, not of its UTC midnight", () => {
    expect(weekdayOf("2026-09-02")).toBe(3);
    expect(dayLabel("2026-09-02")).toBe("Wed 2 Sep");
  });

  it("writes times the way a person says them", () => {
    expect(timeLabel(0)).toBe("12:00 am");
    expect(timeLabel(12 * 60)).toBe("12:00 pm");
    expect(timeLabel(19 * 60 + 30)).toBe("7:30 pm");
  });
});

describe("deriveSlots", () => {
  it("cuts a window into whole slots and stops before overrunning it", () => {
    const [day] = deriveSlots([evening(3)], new Set(), new Set(), WED_MORNING, 0);
    expect(day?.slots.map((slot) => slot.label)).toEqual([
      "7:00 pm",
      "7:30 pm",
      "8:00 pm",
      "8:30 pm",
    ]);
  });

  it("offers nothing on a weekday with no window", () => {
    expect(deriveSlots([evening(1)], new Set(), new Set(), WED_MORNING, 0)).toEqual([]);
  });

  it("drops a blacked-out day entirely, keeping the days around it", () => {
    const days = deriveSlots([evening(3)], new Set(["2026-09-02"]), new Set(), WED_MORNING, 7);
    expect(days.map((day) => day.dayKey)).toEqual(["2026-09-09"]);
  });

  it("subtracts exactly the booked time and leaves its neighbours", () => {
    const taken = new Set([istInstant("2026-09-02", 19 * 60 + 30).getTime()]);
    const [day] = deriveSlots([evening(3)], new Set(), taken, WED_MORNING, 0);
    expect(day?.slots.map((slot) => slot.label)).toEqual(["7:00 pm", "8:00 pm", "8:30 pm"]);
  });

  it("refuses anything inside the two-hour lead time", () => {
    // 6:15 pm IST: 7:00 pm is 45 minutes away and must not be offered; 8:30 pm
    // is far enough and must be.
    const evening615 = new Date("2026-09-02T12:45:00.000Z");
    const [day] = deriveSlots([evening(3)], new Set(), new Set(), evening615, 0);
    expect(day?.slots.map((slot) => slot.label)).toEqual(["8:30 pm"]);
  });

  it("honours effective_from and effective_to", () => {
    const retiring: AvailabilityWindow = { ...evening(3), effectiveTo: "2026-09-02" };
    const days = deriveSlots([retiring], new Set(), new Set(), WED_MORNING, 14);
    expect(days.map((day) => day.dayKey)).toEqual(["2026-09-02"]);

    const future: AvailabilityWindow = { ...evening(3), effectiveFrom: "2026-09-09" };
    const later = deriveSlots([future], new Set(), new Set(), WED_MORNING, 14);
    expect(later.map((day) => day.dayKey)).toEqual(["2026-09-09", "2026-09-16"]);
  });

  it("de-duplicates overlapping windows rather than offering a time twice", () => {
    // "Wednesday 7–9" and "Wednesday 8–10" is a reasonable thing to enter and
    // an unreasonable thing to make somebody think about.
    const overlapping: AvailabilityWindow[] = [
      evening(3),
      { ...evening(3), startMinute: 20 * 60, endMinute: 22 * 60 },
    ];
    const [day] = deriveSlots(overlapping, new Set(), new Set(), WED_MORNING, 0);
    expect(day?.slots.map((slot) => slot.label)).toEqual([
      "7:00 pm",
      "7:30 pm",
      "8:00 pm",
      "8:30 pm",
      "9:00 pm",
      "9:30 pm",
    ]);
  });

  it("returns days in order, and every slot inside a day in order", () => {
    const days = deriveSlots([evening(3), evening(5)], new Set(), new Set(), WED_MORNING, 14);
    const keys = days.map((day) => day.dayKey);
    expect([...keys].sort()).toEqual(keys);
    for (const day of days) {
      const starts = day.slots.map((slot) => Date.parse(slot.startIso));
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    }
  });
});
