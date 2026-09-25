import { describe, expect, it } from "vitest";

import { safeNext } from "../server/auth/redirect";
import { isStartClub, START_CLUB_LOGIN, START_CLUB_PATH } from "./start-intent";

describe("start-club intent", () => {
  it("survives the sign-in redirect guard unchanged", () => {
    // If safeNext ever rejected it, the visitor would land on /home and be
    // asked the question they answered by clicking "Create your tournament".
    expect(safeNext(START_CLUB_PATH)).toBe(START_CLUB_PATH);
  });

  it("is what the landing CTA carries as next", () => {
    const next = new URL(START_CLUB_LOGIN, "http://x").searchParams.get("next");
    expect(next).toBe(START_CLUB_PATH);
    expect(isStartClub(next ?? undefined)).toBe(true);
  });

  it("is not claimed by any other destination", () => {
    expect(isStartClub(undefined)).toBe(false);
    expect(isStartClub("/home")).toBe(false);
  });
});
