import { describe, expect, it } from "vitest";

import { createMediaSigner } from "./s3-signer";

/**
 * The D1 signer, proven against an INDEPENDENT implementation: the two pinned
 * URLs below were produced by a separate SigV4 written in Python (hashlib +
 * hmac, no shared code), over the same test vector. Two implementations that
 * agree byte-for-byte are the strongest correctness statement available
 * without live bucket credentials; the pins also freeze the algorithm against
 * accidental drift (a "small refactor" of canonicalization is exactly how
 * presigned URLs start 403ing in production only).
 */

const signer = createMediaSigner({
  endpoint: "https://s3.ap-south-1.amazonaws.com",
  region: "ap-south-1",
  bucket: "da-media",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  now: () => new Date("2026-08-31T00:00:00Z"),
});

const KEY =
  "org/01ABCDEFGHJKMNPQRSTVWXY1/player/01ABCDEFGHJKMNPQRSTVWXY2/01ABCDEFGHJKMNPQRSTVWXY3.jpg";

describe("media SigV4 query presigning (D1)", () => {
  it("matches the independent implementation for a typed PUT", () => {
    const url = signer({ method: "PUT", key: KEY, contentType: "image/jpeg", expiresSeconds: 300 });
    expect(url).toBe(
      "https://s3.ap-south-1.amazonaws.com/da-media/org/01ABCDEFGHJKMNPQRSTVWXY1/player/01ABCDEFGHJKMNPQRSTVWXY2/01ABCDEFGHJKMNPQRSTVWXY3.jpg" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIDEXAMPLE%2F20260831%2Fap-south-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20260831T000000Z" +
        "&X-Amz-Expires=300" +
        "&X-Amz-SignedHeaders=content-type%3Bhost" +
        "&X-Amz-Signature=d95f10d9739cf0afd0987fb3b0c6745928f46b2f194f21bdc2606d9b5293b7e6",
    );
  });

  it("matches the independent implementation for an untyped DELETE", () => {
    const url = signer({ method: "DELETE", key: KEY, expiresSeconds: 300 });
    expect(url).toBe(
      "https://s3.ap-south-1.amazonaws.com/da-media/org/01ABCDEFGHJKMNPQRSTVWXY1/player/01ABCDEFGHJKMNPQRSTVWXY2/01ABCDEFGHJKMNPQRSTVWXY3.jpg" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIDEXAMPLE%2F20260831%2Fap-south-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20260831T000000Z" +
        "&X-Amz-Expires=300" +
        "&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=fad51e430ab20f1ec635e8e663086138b21e41ed1a1cc2ff05009a68160e890d",
    );
  });

  it("pins the content type into the signature — a retyped PUT gets a different URL", () => {
    const jpeg = signer({
      method: "PUT",
      key: KEY,
      contentType: "image/jpeg",
      expiresSeconds: 300,
    });
    const png = signer({ method: "PUT", key: KEY, contentType: "image/png", expiresSeconds: 300 });
    expect(jpeg).not.toBe(png);
    expect(png).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
  });
});
