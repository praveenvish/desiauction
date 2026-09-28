import { describe, expect, it } from "vitest";

import { signRequest } from "./sigv4";

/*
 * AWS's own SigV4 test suite (aws-sig-v4-test-suite): fixed credentials, a
 * fixed instant, and the signature AWS publishes for each request. Matching
 * these is what proves the signer, rather than a test that re-derives the
 * signature with the same code it is testing.
 */
const SUITE = {
  region: "us-east-1",
  service: "service",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const AT = Date.UTC(2015, 7, 30, 12, 36, 0);
const SCOPE = "AKIDEXAMPLE/20150830/us-east-1/service/aws4_request";

describe("signRequest — AWS SigV4 test suite", () => {
  it("get-vanilla", () => {
    const headers = signRequest(
      { method: "GET", url: "https://example.amazonaws.com/", headers: {}, body: "" },
      SUITE,
      AT,
    );
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers["authorization"]).toBe(
      `AWS4-HMAC-SHA256 Credential=${SCOPE}, SignedHeaders=host;x-amz-date, ` +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("post-vanilla", () => {
    const headers = signRequest(
      { method: "POST", url: "https://example.amazonaws.com/", headers: {}, body: "" },
      SUITE,
      AT,
    );
    expect(headers["authorization"]).toBe(
      `AWS4-HMAC-SHA256 Credential=${SCOPE}, SignedHeaders=host;x-amz-date, ` +
        "Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b",
    );
  });

  it("post-x-www-form-urlencoded — a signed content-type and a body", () => {
    const headers = signRequest(
      {
        method: "POST",
        url: "https://example.amazonaws.com/",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "Param1=value1",
      },
      SUITE,
      AT,
    );
    expect(headers["authorization"]).toBe(
      `AWS4-HMAC-SHA256 Credential=${SCOPE}, SignedHeaders=content-type;host;x-amz-date, ` +
        "Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a",
    );
  });

  it("returns the caller's headers lower-cased, alongside host and the date", () => {
    const headers = signRequest(
      {
        method: "POST",
        url: "https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      { ...SUITE, region: "ap-south-1", service: "ses" },
      AT,
    );
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["host"]).toBe("email.ap-south-1.amazonaws.com");
    expect(headers["authorization"]).toContain("/20150830/ap-south-1/ses/aws4_request");
    // The secret is an input to the signature, never part of any header.
    expect(JSON.stringify(headers)).not.toContain(SUITE.secretAccessKey);
  });
});
