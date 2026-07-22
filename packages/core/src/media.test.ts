import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_BYTES,
  deriveMediaKey,
  isAllowedImageType,
  isValidMediaKey,
  mediaKeyBelongsTo,
  validateUpload,
} from "./media";

describe("media validation", () => {
  it("accepts allowed image types only", () => {
    expect(isAllowedImageType("image/png")).toBe(true);
    expect(isAllowedImageType("image/webp")).toBe(true);
    expect(isAllowedImageType("image/gif")).toBe(false);
    expect(isAllowedImageType("application/pdf")).toBe(false);
  });

  it("rejects empty, oversized, and wrong-type uploads with a message", () => {
    expect(validateUpload({ contentType: "image/png", byteSize: 1024 })).toEqual({ ok: true });
    expect(validateUpload({ contentType: "image/png", byteSize: 0 }).ok).toBe(false);
    expect(validateUpload({ contentType: "image/png", byteSize: MAX_IMAGE_BYTES + 1 }).ok).toBe(
      false,
    );
    expect(validateUpload({ contentType: "image/gif", byteSize: 10 }).ok).toBe(false);
  });
});

describe("deriveMediaKey", () => {
  it("is tenant-scoped, deterministic, and carries the right extension", () => {
    const key = deriveMediaKey({
      orgId: "org_1",
      subject: "player",
      subjectId: "reg_9",
      contentType: "image/jpeg",
      token: "tok123",
    });
    expect(key).toBe("org/org_1/player/reg_9/tok123.jpg");
  });

  it("changes only where inputs change", () => {
    const base = {
      orgId: "org_1",
      subject: "team" as const,
      subjectId: "team_2",
      contentType: "image/webp" as const,
      token: "a",
    };
    expect(deriveMediaKey(base)).toBe("org/org_1/team/team_2/a.webp");
    expect(deriveMediaKey({ ...base, token: "b" })).toBe("org/org_1/team/team_2/b.webp");
  });
});

describe("isValidMediaKey (S1 — traversal-safe key gate)", () => {
  // A realistic key: 26-char ULID segments, exactly what deriveMediaKey emits.
  const ULID = "01HZ0000000000000000000000";
  const good = deriveMediaKey({
    orgId: ULID,
    subject: "player",
    subjectId: ULID,
    contentType: "image/jpeg",
    token: ULID,
  });

  it("accepts a well-formed key produced by deriveMediaKey", () => {
    expect(good).toBe(`org/${ULID}/player/${ULID}/${ULID}.jpg`);
    expect(isValidMediaKey(good)).toBe(true);
    expect(isValidMediaKey(`org/${ULID}/team/${ULID}/${ULID}.png`)).toBe(true);
    expect(isValidMediaKey(`org/${ULID}/competition/${ULID}/${ULID}.webp`)).toBe(true);
  });

  it("REJECTS path traversal, absolute paths, and separators", () => {
    expect(isValidMediaKey(`org/${ULID}/team/${ULID}/../../../../etc/passwd`)).toBe(false);
    expect(isValidMediaKey(`org/${ULID}/team/../../../../${ULID}/x.png`)).toBe(false);
    expect(isValidMediaKey(`../${ULID}/team/${ULID}/${ULID}.png`)).toBe(false);
    expect(isValidMediaKey(`/etc/passwd`)).toBe(false);
    expect(isValidMediaKey(`org/${ULID}/team/${ULID}/${ULID}.png/../evil`)).toBe(false);
  });

  it("REJECTS wrong shape, subject, extension, or segment length", () => {
    expect(isValidMediaKey("")).toBe(false);
    expect(isValidMediaKey(`org/${ULID}/owner/${ULID}/${ULID}.png`)).toBe(false); // bad subject
    expect(isValidMediaKey(`org/${ULID}/team/${ULID}/${ULID}.svg`)).toBe(false); // bad ext
    expect(isValidMediaKey(`org/${ULID}/team/${ULID}/${ULID}.gif`)).toBe(false);
    expect(isValidMediaKey(`org/short/team/${ULID}/${ULID}.png`)).toBe(false); // short id
    expect(isValidMediaKey(`s3://bucket/${ULID}.png`)).toBe(false);
  });
});

describe("mediaKeyBelongsTo (S2 — attach binding)", () => {
  const ORG = "01HZORG0000000000000000000";
  const SUBJ = "01HZSUBJECT000000000000000";
  const OTHER = "01HZOTHER00000000000000000";
  const target = { orgId: ORG, subject: "team" as const, subjectId: SUBJ };
  const own = deriveMediaKey({
    orgId: ORG,
    subject: "team",
    subjectId: SUBJ,
    contentType: "image/png",
    token: "01HZTOKEN00000000000000000",
  });

  it("accepts the key the caller was authorized to write", () => {
    expect(mediaKeyBelongsTo(own, target)).toBe(true);
  });

  it("REJECTS a cross-tenant org, a foreign subjectId, or a wrong subject type", () => {
    expect(mediaKeyBelongsTo(own, { ...target, orgId: OTHER })).toBe(false);
    expect(mediaKeyBelongsTo(own, { ...target, subjectId: OTHER })).toBe(false);
    expect(mediaKeyBelongsTo(own, { ...target, subject: "player" })).toBe(false);
  });

  it("REJECTS a malformed key regardless of target", () => {
    expect(mediaKeyBelongsTo(`org/${ORG}/team/${SUBJ}/../../x`, target)).toBe(false);
    expect(mediaKeyBelongsTo("", target)).toBe(false);
  });
});
