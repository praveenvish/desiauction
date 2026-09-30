import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { env } from "../../env";
import { authCodeSecret } from "./auth-secret";
import { boundSubject, codeDigest } from "./code-digest";

/**
 * THE STORED FORM OF A CODE, PINNED BYTE FOR BYTE.
 *
 * Every code waiting in `otp_codes` and `email_verifications` was stored under
 * this exact construction, so any change to it — the key prefix, the
 * separator, the order — fails every code in flight. The separator is a NUL
 * character, which is invisible in an editor and was, for a while, typed into
 * the source as a raw byte: git then called the file binary and grep skipped
 * it without a word. It is written as an escape now, and this is what proves
 * the escape and the raw byte are the same string.
 */
const expected = (purpose: string, subject: string, code: string): string =>
  createHmac("sha256", `short-code-digest:${authCodeSecret(env)}`)
    .update([purpose, subject, code].join("\u0000"))
    .digest("hex");

describe("how a short code is stored", () => {
  it("is HMAC-SHA256 over purpose, subject and code, NUL-separated, under the auth key", () => {
    expect(codeDigest("otp:login", "+919999000001", "123456")).toBe(
      expected("otp:login", "+919999000001", "123456"),
    );
    expect(codeDigest("email:login", "a@example.com", "000000")).toBe(
      expected("email:login", "a@example.com", "000000"),
    );
  });

  it("separates its parts: moving a character across a boundary changes the digest", () => {
    expect(codeDigest("otp:login", "+9199990000011", "23456")).not.toBe(
      codeDigest("otp:login", "+919999000001", "123456"),
    );
  });

  it("binds a change code to the account that asked for it", () => {
    const mine = codeDigest(
      "otp:phone_change",
      boundSubject("person-a", "+919999000002"),
      "123456",
    );
    const theirs = codeDigest(
      "otp:phone_change",
      boundSubject("person-b", "+919999000002"),
      "123456",
    );
    expect(mine).not.toBe(theirs);
  });

  it("is a source file a text tool can read: no raw control bytes", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "code-digest.ts"));
    expect(source.includes(0)).toBe(false);
  });
});
