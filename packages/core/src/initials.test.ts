import { describe, expect, it } from "vitest";

import { initialsOf } from "./initials";
import { buildTeamPoster, firstNameOf, monogramOf, shortNameOf } from "./poster";

describe("initialsOf — one idea of a letter, any script", () => {
  it("a person: first and last word", () => {
    expect(initialsOf("Rohit Sharma")).toBe("RS");
    expect(initialsOf("Rohit Gurunath Sharma")).toBe("RS");
    expect(initialsOf("kapil dev")).toBe("KD");
  });

  it("Hindi: the base letter, never a vowel sign", () => {
    expect(initialsOf("राम कुमार")).toBe("रक");
    expect(initialsOf("रोहित शर्मा")).toBe("रश");
    expect(initialsOf("कमलेश")).toBe("क");
    expect(initialsOf("ऋद्धि सिद्धि")).toBe("ऋस");
  });

  it("a name mixing scripts takes each word's own letter", () => {
    expect(initialsOf("सुरेश Hudda")).toBe("सH");
  });

  it("a club or season: its first two words, and two letters of one word", () => {
    expect(initialsOf("Demo Premier League", { words: "first-two" })).toBe("DP");
    expect(initialsOf("Pune", { words: "first-two", singleWord: 2 })).toBe("PU");
    expect(initialsOf("रघुनाथपुरा", { words: "first-two", singleWord: 2 })).toBe("रघ");
  });

  it("skips punctuation, and gives nothing when there is no letter", () => {
    expect(initialsOf("Demo Cup (settled)")).toBe("DS");
    expect(initialsOf("  ")).toBe("");
    expect(initialsOf("🏏 !!")).toBe("");
  });
});

describe("poster names cut by letters, never mid-letter", () => {
  it("monogramOf: Hindi names get letters, not '?'", () => {
    expect(monogramOf("कमलेश")).toBe("क");
    expect(monogramOf("सुरेश कुमार")).toBe("सक");
    expect(monogramOf("")).toBe("?");
  });

  it("firstNameOf keeps a vowel sign with its letter when it cuts", () => {
    // 11 letters; the cut keeps 9 and adds "…", and every kept letter is whole.
    const cut = firstNameOf("रघुनाथपुराकेदारनाथ");
    expect(cut.endsWith("…")).toBe(true);
    const kept = cut.slice(0, -1);
    expect(/[ा-्]$/u.test(kept) || /[क-ह]$/u.test(kept)).toBe(true);
    expect(/्$/u.test(kept)).toBe(false);
  });

  it("shortNameOf: a Hindi surname becomes its letter", () => {
    expect(shortNameOf("दिनेश कुमार")).toBe("दिनेश क.");
  });

  it("a squad row's circle matches its label's script", () => {
    const poster = buildTeamPoster({
      competitionName: "BPL-4",
      competitionLogoUrl: null,
      teamName: "आशापुरा इलेवन",
      teamCrestUrl: null,
      unit: "inr",
      spentPaise: 0,
      pursePaise: 0,
      members: [
        {
          name: "हितेश Sharma",
          role: "batter",
          pricePaise: null,
          marks: ["captain"],
          photoUrl: null,
        },
      ],
    });
    const row = JSON.stringify(poster);
    expect(row).toContain('"monogram":"हS"');
  });
});
