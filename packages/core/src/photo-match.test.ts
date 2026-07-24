import { describe, expect, it } from "vitest";

import { fileStem, matchPhotoFiles, type PhotoTarget } from "./photo-match";

const ROHIT: PhotoTarget = {
  registrationId: "reg_rohit",
  number: "R7K2M9",
  name: "Rohit Sharma",
  phone: "+919876543210",
  hasPhoto: false,
};
const JASPRIT: PhotoTarget = {
  registrationId: "reg_jasprit",
  number: "R4B8N1",
  name: "Jasprit Bumrah",
  phone: "+919876543211",
  hasPhoto: true,
};
const OTHER_ROHIT: PhotoTarget = {
  registrationId: "reg_rohit_2",
  number: "RZZ001",
  name: "rohit  sharma",
  phone: "+919000000002",
  hasPhoto: false,
};

const TARGETS = [ROHIT, JASPRIT];

describe("matchPhotoFiles — decide the whole batch before a byte is uploaded", () => {
  it("matches by registration number, phone, or full name", () => {
    const third: PhotoTarget = { ...OTHER_ROHIT, name: "Shubman Gill" };
    const matched = matchPhotoFiles(
      ["r7k2m9.jpg", "9876543211.png", "Shubman Gill.JPEG"],
      [ROHIT, JASPRIT, third],
    );
    expect(matched.map((m) => (m.ok ? [m.rule, m.target.registrationId] : m.reason))).toEqual([
      ["number", "reg_rohit"],
      ["phone", "reg_jasprit"],
      ["name", "reg_rohit_2"],
    ]);
  });

  it("reads a mobile out of a longer filename, in any of its written forms", () => {
    const files = ["WhatsApp Image 9876543210.jpg", "+91 98765 43210.jpg", "919876543210-1.png"];
    for (const file of files) {
      const [match] = matchPhotoFiles([file], TARGETS);
      expect(match?.ok === true && match.target.registrationId, file).toBe("reg_rohit");
    }
  });

  it("separators and case in a name do not decide the match", () => {
    for (const file of ["rohit_sharma.jpg", "ROHIT-SHARMA.png", "rohit.sharma.webp"]) {
      const [match] = matchPhotoFiles([file], TARGETS);
      expect(match?.ok === true && match.target.registrationId, file).toBe("reg_rohit");
    }
  });

  it("refuses to guess when two players share a name", () => {
    const [match] = matchPhotoFiles(["rohit sharma.jpg"], [ROHIT, OTHER_ROHIT]);
    expect(match?.ok).toBe(false);
    expect(match?.ok === false && match.reason).toMatch(/more than one player by name/);
  });

  it("reports a file that matches nobody, and says how to name it", () => {
    const [match] = matchPhotoFiles(["team photo.jpg"], TARGETS);
    expect(match?.ok).toBe(false);
    expect(match?.ok === false && match.reason).toMatch(/registration number/);
  });

  it("gives a player at most one file — the first that claimed them", () => {
    const matched = matchPhotoFiles(["r7k2m9.jpg", "9876543210.jpg"], TARGETS);
    expect(matched[0]?.ok).toBe(true);
    expect(matched[1]?.ok).toBe(false);
    expect(matched[1]?.ok === false && matched[1].reason).toMatch(/already matched/);
  });

  it("keeps one entry per input file, in the order given", () => {
    const files = ["b.jpg", "r7k2m9.jpg", "a.jpg"];
    expect(matchPhotoFiles(files, TARGETS).map((m) => m.file)).toEqual(files);
  });

  it("carries hasPhoto through so the review table can call it a replacement", () => {
    const [match] = matchPhotoFiles(["R4B8N1.jpg"], TARGETS);
    expect(match?.ok === true && match.target.hasPhoto).toBe(true);
  });

  it("an unnamed player is not matched by an empty filename", () => {
    const nameless: PhotoTarget = { ...ROHIT, name: null };
    const [match] = matchPhotoFiles([".jpg"], [nameless]);
    expect(match?.ok).toBe(false);
  });
});

describe("fileStem", () => {
  it("drops the extension and normalizes case", () => {
    expect(fileStem("Rohit Sharma.JPG")).toBe("rohit sharma");
    expect(fileStem("no-extension")).toBe("no-extension");
    expect(fileStem("two.dots.png")).toBe("two.dots");
  });
});
