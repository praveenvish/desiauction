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

/*
 * PHASE 4 — the folder a club actually hands over.
 *
 * A Google Form file-upload question stores the answer with the QUESTION
 * appended, and adds a counter when a name repeats. Downloaded and dropped into
 * the importer, almost none of these used to match.
 */
describe("matchPhotoFiles — filenames as a Drive export writes them", () => {
  it("matches a name with the form's question appended", () => {
    const [match] = matchPhotoFiles(["Rohit Sharma - Upload your photo.jpg"], TARGETS);
    expect(match?.ok).toBe(true);
    expect(match?.ok === true ? match.target.registrationId : null).toBe("reg_rohit");
    expect(match?.ok === true ? match.rule : null).toBe("name");
  });

  it("matches through a copy counter", () => {
    for (const file of ["Rohit Sharma (1).jpg", "Rohit Sharma(2).png"]) {
      const [match] = matchPhotoFiles([file], TARGETS);
      expect(match?.ok, file).toBe(true);
    }
  });

  it("matches a counter and a question together", () => {
    const [match] = matchPhotoFiles(["Rohit Sharma - Player Photo (3).jpg"], TARGETS);
    expect(match?.ok).toBe(true);
    expect(match?.ok === true ? match.target.registrationId : null).toBe("reg_rohit");
  });

  it("still matches a registration number or phone wearing the same suffix", () => {
    const byNumber = matchPhotoFiles(["R7K2M9 - Upload your photo.jpg"], TARGETS)[0];
    expect(byNumber?.ok === true ? byNumber.rule : null).toBe("number");
    const byPhone = matchPhotoFiles(["9876543210 (1).jpg"], TARGETS)[0];
    expect(byPhone?.ok === true ? byPhone.rule : null).toBe("phone");
  });

  /*
   * The stripping must not reach past what it is for. A numbered roster puts
   * the index FIRST, and the player is what follows — cutting a leading segment
   * would turn "12 - Rohit Sharma" into "12" and match nobody, or worse, a
   * player whose number happens to be 12.
   */
  it("does not strip a LEADING segment", () => {
    const [match] = matchPhotoFiles(["12 - Rohit Sharma.jpg"], TARGETS);
    expect(match?.ok).toBe(true);
    expect(match?.ok === true ? match.target.registrationId : null).toBe("reg_rohit");
  });

  it("keeps a hyphenated name intact", () => {
    const hyphen: PhotoTarget = {
      registrationId: "reg_jp",
      number: "RJP001",
      name: "Jean-Paul Duminy",
      phone: "+919000000009",
      hasPhoto: false,
    };
    const [match] = matchPhotoFiles(["Jean-Paul Duminy.jpg"], [hyphen]);
    expect(match?.ok).toBe(true);
  });

  /*
   * AMBIGUITY STILL REFUSES. Loosening what a filename may look like must not
   * loosen the rule that a file matching two players is never guessed at.
   */
  it("refuses a stripped form that matches two players", () => {
    const [match] = matchPhotoFiles(["Rohit Sharma - Upload your photo.jpg"], [ROHIT, OTHER_ROHIT]);
    expect(match?.ok).toBe(false);
    expect(match?.ok === false ? match.reason : "").toMatch(/more than one/i);
  });

  /*
   * An EXACT stem must beat another player's stripped form, or one badly named
   * file could steal the photo of a correctly named one.
   */
  it("prefers the file named exactly after a player", () => {
    const decoy: PhotoTarget = {
      registrationId: "reg_decoy",
      number: "RDEC01",
      name: "Rohit Sharma - Upload your photo",
      phone: "+919000000003",
      hasPhoto: false,
    };
    const [match] = matchPhotoFiles(["Rohit Sharma - Upload your photo.jpg"], [ROHIT, decoy]);
    expect(match?.ok).toBe(true);
    expect(match?.ok === true ? match.target.registrationId : null).toBe("reg_decoy");
  });
});

/**
 * A TARGET WITH NO PHONE (0062).
 *
 * An email-anchored account has no number. The indexer read `target.phone`
 * unconditionally, so one such target made `matchPhotoFiles` THROW — taking
 * the whole batch down, including the files that matched by number or name.
 * The other two rules must go on working, and a phone-shaped filename must
 * simply not find them.
 */
describe("a target with no phone", () => {
  const NO_PHONE: PhotoTarget = { ...ROHIT, phone: null };
  const ALSO_NO_PHONE: PhotoTarget = {
    registrationId: "reg-np2",
    number: "RNP002",
    name: "Shubman Gill",
    phone: null,
    hasPhoto: false,
  };

  it("still matches on its registration number", () => {
    const [result] = matchPhotoFiles(["RNP001.jpg"], [{ ...NO_PHONE, number: "RNP001" }]);
    expect(result?.ok === true && result.rule).toBe("number");
  });

  it("still matches on its name", () => {
    const [result] = matchPhotoFiles(["rohit-sharma.jpg"], [NO_PHONE, ALSO_NO_PHONE]);
    expect(result?.ok === true && result.rule).toBe("name");
  });

  it("is not reachable by a phone-shaped filename", () => {
    const [result] = matchPhotoFiles(["9876543210.jpg"], [NO_PHONE, ALSO_NO_PHONE]);
    expect(result?.ok).toBe(false);
  });
});
