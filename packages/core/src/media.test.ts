import { describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES, deriveMediaKey, isAllowedImageType, validateUpload } from "./media";

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
