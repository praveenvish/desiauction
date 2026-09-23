import { describe, expect, it } from "vitest";

import { consentedPhotoUrl, publicPhotoUrl } from "./shown-name";

const sign = (key: string) => `/media/${key}`;
const NOW = new Date("2026-09-19T00:00:00Z");

describe("the shown photo, as a URL", () => {
  it("needs consent before it is ever signed", () => {
    const signed: string[] = [];
    const url = consentedPhotoUrl({ photoKey: "k/a.jpg", photoConsentAt: null }, (key) => {
      signed.push(key);
      return sign(key);
    });
    expect(url).toBeNull();
    expect(signed, "an unconsented key is never signed").toEqual([]);
    expect(consentedPhotoUrl({ photoKey: "k/a.jpg", photoConsentAt: NOW }, sign)).toBe(
      "/media/k/a.jpg",
    );
    expect(consentedPhotoUrl({ photoKey: null, photoConsentAt: NOW }, sign)).toBeNull();
  });

  it("withholds a minor's face on public surfaces, whatever consent says (PRR P0-2)", () => {
    const row = { photoKey: "k/a.jpg", photoConsentAt: NOW };
    expect(publicPhotoUrl({ ...row, dateOfBirth: "2015-01-01" }, NOW, sign)).toBeNull();
    expect(publicPhotoUrl({ ...row, dateOfBirth: "1995-01-01" }, NOW, sign)).toBe("/media/k/a.jpg");
  });

  it("withholds a face of UNKNOWN age on public surfaces (P0-6 — fails closed)", () => {
    const row = { photoKey: "k/a.jpg", photoConsentAt: NOW };
    expect(publicPhotoUrl({ ...row, dateOfBirth: null }, NOW, sign)).toBeNull();
    expect(publicPhotoUrl({ ...row, dateOfBirth: "not-a-date" }, NOW, sign)).toBeNull();
    // The authenticated desk is unchanged: consent alone decides there.
    expect(consentedPhotoUrl(row, sign)).toBe("/media/k/a.jpg");
  });
});
