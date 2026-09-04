import { describe, expect, it } from "vitest";

import { isAmbiguousDate, parseCsvDate } from "./csv-date";

describe("parseCsvDate — read the date a form wrote, or say you cannot", () => {
  it("reads ISO unchanged", () => {
    expect(parseCsvDate("1998-03-15")).toBe("1998-03-15");
    expect(parseCsvDate("1998/03/15")).toBe("1998-03-15");
  });

  it("reads the shape this market actually types", () => {
    for (const input of ["15/03/1998", "15-03-1998", "15.03.1998", "15 03 1998"]) {
      expect(parseCsvDate(input)).toBe("1998-03-15");
    }
  });

  it("pads single-digit days and months", () => {
    expect(parseCsvDate("5/3/1998")).toBe("1998-03-05");
  });

  it("drops the clock a Google Form stamps onto a response", () => {
    expect(parseCsvDate("15/03/1998 14:32:11")).toBe("1998-03-15");
    expect(parseCsvDate("15/03/1998 2:32:11 PM")).toBe("1998-03-15");
    expect(parseCsvDate("1998-03-15 09:00")).toBe("1998-03-15");
  });

  it("reads a named month either way round", () => {
    expect(parseCsvDate("15 Mar 1998")).toBe("1998-03-15");
    expect(parseCsvDate("15 March 1998")).toBe("1998-03-15");
    expect(parseCsvDate("Mar 15, 1998")).toBe("1998-03-15");
    expect(parseCsvDate("March 15 1998")).toBe("1998-03-15");
  });

  /*
   * The whole point of the `order` parameter. Both readings of 03/04/1998 are
   * real days, so the value alone cannot settle it and the caller must.
   */
  it("uses the stated order, and only when the value is genuinely ambiguous", () => {
    expect(parseCsvDate("03/04/1998", "dmy")).toBe("1998-04-03");
    expect(parseCsvDate("03/04/1998", "mdy")).toBe("1998-03-04");
  });

  it("ignores the stated order when the value can only be read one way", () => {
    // There is no 15th month, whatever the caller believes about this file.
    expect(parseCsvDate("15/03/1998", "mdy")).toBe("1998-03-15");
    expect(parseCsvDate("03/15/1998", "dmy")).toBe("1998-03-15");
  });

  it("refuses a two-digit year rather than picking a century", () => {
    expect(parseCsvDate("15/03/98")).toBeNull();
    expect(parseCsvDate("15-03-98")).toBeNull();
  });

  it("refuses dates that are not days", () => {
    expect(parseCsvDate("30/02/1998")).toBeNull();
    expect(parseCsvDate("31/04/1998")).toBeNull();
    expect(parseCsvDate("1998-13-01")).toBeNull();
    expect(parseCsvDate("00/03/1998")).toBeNull();
  });

  it("refuses junk, blanks and half-written values", () => {
    for (const input of ["", "   ", "not a date", "1998", "15/03", "Marchish 1998", "15/xx/1998"]) {
      expect(parseCsvDate(input)).toBeNull();
    }
  });
});

describe("isAmbiguousDate — ask once for the file, never guess per row", () => {
  it("flags only values whose two readings disagree", () => {
    expect(isAmbiguousDate("03/04/1998")).toBe(true);
    expect(isAmbiguousDate("04/03/1998 10:00:00")).toBe(true);
  });

  it("does not flag a value that reads one way", () => {
    expect(isAmbiguousDate("15/03/1998")).toBe(false); // no 15th month
    expect(isAmbiguousDate("1998-03-15")).toBe(false); // states its own order
    expect(isAmbiguousDate("03/03/1998")).toBe(false); // both readings agree
    expect(isAmbiguousDate("15 Mar 1998")).toBe(false); // month is named
    expect(isAmbiguousDate("nonsense")).toBe(false);
  });
});
