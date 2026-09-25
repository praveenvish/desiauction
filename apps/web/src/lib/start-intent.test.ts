import { describe, expect, it } from "vitest";

import { safeNext } from "../server/auth/redirect";
import { isRegisterNext, isStartClub, START_CLUB_LOGIN, START_CLUB_PATH } from "./start-intent";

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

describe("registration intent", () => {
  it("recognises a season's registration link, with or without a query", () => {
    expect(isRegisterNext("/seasons/tpl-2026-4s7c/register")).toBe(true);
    expect(isRegisterNext("/seasons/tpl-2026-4s7c/register?ref=whatsapp")).toBe(true);
  });

  it("does not claim other season pages", () => {
    expect(isRegisterNext("/seasons/tpl-2026-4s7c/registrations")).toBe(false);
    expect(isRegisterNext("/seasons/tpl-2026-4s7c")).toBe(false);
    expect(isRegisterNext(undefined)).toBe(false);
  });
});
