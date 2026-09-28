import { describe, expect, it } from "vitest";

import { orgFacts, orgFlags, userFacts, userFlags } from "./directory-model";

describe("orgFacts / orgFlags", () => {
  it("says what the club has done, zeros left out", () => {
    expect(orgFacts({ competitions: 2, members: 3, auctions: 0 })).toBe("2 seasons · 3 members");
    expect(orgFacts({ competitions: 0, members: 0, auctions: 0 })).toBe("Nothing yet");
  });

  it("flags only what asks for an operator, most urgent first", () => {
    expect(
      orgFlags({ openCases: 1, settledCases: 1, financeDeclared: true, competitions: 2 }).map(
        (f) => f.label,
      ),
    ).toEqual(["1 case open", "Settled, not closed", "Finance"]);
    expect(
      orgFlags({ openCases: 0, settledCases: 0, financeDeclared: false, competitions: 0 }),
    ).toEqual([{ label: "No seasons", tone: "neutral" }]);
  });
});

describe("userFacts / userFlags", () => {
  it("says what the person is", () => {
    expect(userFacts({ name: "A", orgs: 1, seasons: 2 })).toBe("Player · 2 seasons · 1 club");
    expect(userFacts({ name: "A", orgs: 0, seasons: 0 })).toBe("No club or season yet");
    expect(userFacts({ name: null, orgs: 0, seasons: 0 })).toBe(
      "Signed in, never finished onboarding",
    );
  });

  it("flags grants only when there are some", () => {
    expect(userFlags({ activeGrants: 0 })).toEqual([]);
    expect(userFlags({ activeGrants: 2 })[0]?.label).toBe("2 grants");
  });
});
