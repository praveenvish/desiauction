import { expect, it } from "vitest";
import { publicName } from "./public-name";
it("uses match-day age, keeps unknown DOB adult names and withholds a name without a match date", () => {
  const person = { name: "Adrian Young" };
  const matchDate = new Date("2026-10-09T00:00:00Z");
  expect(publicName(person, { dateOfBirth: "2008-10-10" }, matchDate)).toEqual({
    name: "AY",
    initials: "AY",
    minor: true,
  });
  expect(publicName(person, { dateOfBirth: "2008-10-09" }, matchDate)).toEqual({
    name: "Adrian Young",
    initials: "AY",
    minor: false,
  });
  expect(publicName(person, { dateOfBirth: null }, matchDate).name).toBe("Adrian Young");
  expect(publicName(person, { dateOfBirth: null }, null).name).toBe("AY");
});
