// EVERY E2E SIGN-IN CODE IS TYPED, NOT FILLED — kept true by a scan.
//
// The code fields submit a code that arrives whole (a paste, the keyboard's
// "From Messages" suggestion) and wait for the button when digits are typed.
// Playwright's `fill()` looks like typing in Chromium and like a paste in
// Firefox, so a filled code submitted itself in Firefox and the spec then
// waited two minutes to click a button that had gone. 216656f5 moved every
// phone code to `pressSequentially`; the email and step-up codes written
// afterwards went back to `fill()` and failed the Firefox nightly every night
// until this scan. e2e/otp-entry.spec.ts pastes ON PURPOSE (it proves the
// paste path), so it is the one file allowed to.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const DIRS = ["e2e", "e2e-sim"];
const PASTES_ON_PURPOSE = new Set(["e2e/otp-entry.spec.ts"]);
const FILLED_CODE = /\.fill\(\s*(?:await\s+)?(?:mailedCode|latestOtp|latestEmailCode)\(/;

function specs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "node_modules" ? [] : specs(path);
    }
    return /\.ts$/.test(name) ? [path] : [];
  });
}

describe("e2e sign-in codes", () => {
  const files = DIRS.flatMap((dir) => specs(join(ROOT, dir)));

  it("finds the specs it is meant to police", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("types every code instead of filling it (Firefox reads fill as a paste)", () => {
    const offenders = files
      .map((path) => relative(ROOT, path))
      .filter((path) => !PASTES_ON_PURPOSE.has(path))
      .flatMap((path) =>
        readFileSync(join(ROOT, path), "utf8")
          .split("\n")
          .flatMap((line, index) =>
            FILLED_CODE.test(line) ? [`${path}:${String(index + 1)}`] : [],
          ),
      );
    expect(offenders).toEqual([]);
  });
});
