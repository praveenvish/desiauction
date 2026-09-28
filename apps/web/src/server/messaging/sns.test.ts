import { createSign, generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createCertFetcher,
  isSnsUrl,
  parseSnsEnvelope,
  snsStringToSign,
  verifySnsSignature,
  type SnsEnvelope,
} from "./sns";

// A key pair standing in for SNS's certificate: the verifier accepts a public
// key PEM as readily as a certificate, so no X.509 needs minting here.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const CERT_URL = "https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-abc.pem";

function signed(
  fields: Omit<SnsEnvelope, "Signature" | "SignatureVersion" | "SigningCertURL">,
  version: "1" | "2" = "2",
): SnsEnvelope {
  const unsigned = {
    ...fields,
    SignatureVersion: version,
    SigningCertURL: CERT_URL,
    Signature: "",
  };
  const signature = createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256")
    .update(snsStringToSign(unsigned))
    .sign(privateKey, "base64");
  return { ...unsigned, Signature: signature };
}

const NOTIFICATION = {
  Type: "Notification",
  MessageId: "22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324",
  TopicArn: "arn:aws:sns:ap-south-1:123456789012:desiauction-ses-events",
  Subject: "Amazon SES Email Event Notification",
  Message: '{"eventType":"Delivery"}',
  Timestamp: "2026-09-28T10:00:00.000Z",
};

const fetchOurKey = () => Promise.resolve(PUBLIC_PEM);

describe("snsStringToSign — AWS's canonical form", () => {
  it("lists a notification's fields in AWS's order, Subject only when present", () => {
    expect(snsStringToSign({ ...signed(NOTIFICATION) })).toBe(
      "Message\n" +
        '{"eventType":"Delivery"}\n' +
        "MessageId\n22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324\n" +
        "Subject\nAmazon SES Email Event Notification\n" +
        "Timestamp\n2026-09-28T10:00:00.000Z\n" +
        "TopicArn\narn:aws:sns:ap-south-1:123456789012:desiauction-ses-events\n" +
        "Type\nNotification\n",
    );
    const noSubject = {
      Type: NOTIFICATION.Type,
      MessageId: NOTIFICATION.MessageId,
      TopicArn: NOTIFICATION.TopicArn,
      Message: NOTIFICATION.Message,
      Timestamp: NOTIFICATION.Timestamp,
    };
    expect(snsStringToSign(signed(noSubject))).not.toContain("Subject");
    // JSON null is read as absent, as SNS means it.
    const withNull = parseSnsEnvelope(JSON.stringify({ ...signed(noSubject), Subject: null }));
    expect(withNull === null ? null : snsStringToSign(withNull)).not.toContain("Subject");
  });

  it("includes SubscribeURL and Token for a subscription confirmation", () => {
    const text = snsStringToSign(
      signed({
        ...NOTIFICATION,
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription",
        Token: "tok",
      }),
    );
    expect(text).toContain("SubscribeURL\nhttps://sns.ap-south-1.amazonaws.com/");
    expect(text).toContain("Token\ntok\n");
  });
});

describe("verifySnsSignature", () => {
  it("accepts a message signed with SHA256 (v2) and with SHA1 (v1)", async () => {
    expect(await verifySnsSignature(signed(NOTIFICATION, "2"), fetchOurKey)).toBe(true);
    expect(await verifySnsSignature(signed(NOTIFICATION, "1"), fetchOurKey)).toBe(true);
  });

  it("refuses a message altered after signing", async () => {
    const tampered = { ...signed(NOTIFICATION), Message: '{"eventType":"Complaint"}' };
    expect(await verifySnsSignature(tampered, fetchOurKey)).toBe(false);
  });

  it("refuses a key that is not SNS's", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const otherPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(await verifySnsSignature(signed(NOTIFICATION), () => Promise.resolve(otherPem))).toBe(
      false,
    );
  });

  it("never fetches a certificate from anywhere but sns.<region>.amazonaws.com", async () => {
    const fetchCert = vi.fn(fetchOurKey);
    for (const url of [
      "https://sns.ap-south-1.amazonaws.com.evil.test/cert.pem",
      "http://sns.ap-south-1.amazonaws.com/cert.pem",
      "https://evil.test/sns.ap-south-1.amazonaws.com/cert.pem",
      "https://sns.ap-south-1.amazonaws.com/cert.txt",
      "https://sns.ap-south-1.amazonaws.com:8443/cert.pem",
    ]) {
      expect(
        await verifySnsSignature({ ...signed(NOTIFICATION), SigningCertURL: url }, fetchCert),
      ).toBe(false);
    }
    expect(fetchCert).not.toHaveBeenCalled();
  });

  it("refuses an unknown SignatureVersion and a fetch that fails", async () => {
    expect(
      await verifySnsSignature({ ...signed(NOTIFICATION), SignatureVersion: "3" }, fetchOurKey),
    ).toBe(false);
    expect(
      await verifySnsSignature(signed(NOTIFICATION), () => Promise.reject(new Error("down"))),
    ).toBe(false);
  });
});

describe("parseSnsEnvelope and isSnsUrl", () => {
  it("rejects bodies missing a signed field", () => {
    expect(parseSnsEnvelope("not json")).toBeNull();
    expect(parseSnsEnvelope(JSON.stringify({ ...signed(NOTIFICATION), Signature: 42 }))).toBeNull();
    expect(parseSnsEnvelope(JSON.stringify({ ...signed(NOTIFICATION), Token: 7 }))).toBeNull();
    expect(parseSnsEnvelope(JSON.stringify(signed(NOTIFICATION)))).not.toBeNull();
  });

  it("accepts only https SNS hosts", () => {
    expect(isSnsUrl("https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription")).toBe(true);
    expect(isSnsUrl("https://sns.us-east-1.amazonaws.com/x.pem", { pem: true })).toBe(true);
    expect(isSnsUrl("https://s3.ap-south-1.amazonaws.com/x.pem", { pem: true })).toBe(false);
  });
});

describe("createCertFetcher", () => {
  it("fetches a certificate once and reuses it", async () => {
    const transport = vi.fn(() => Promise.resolve({ status: 200, body: PUBLIC_PEM }));
    const fetchCert = createCertFetcher(transport);
    await fetchCert(CERT_URL);
    await fetchCert(CERT_URL);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed fetch", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ status: 503, body: "" })
      .mockResolvedValueOnce({ status: 200, body: PUBLIC_PEM });
    const fetchCert = createCertFetcher(transport);
    await expect(fetchCert(CERT_URL)).rejects.toThrow();
    await expect(fetchCert(CERT_URL)).resolves.toBe(PUBLIC_PEM);
  });
});
