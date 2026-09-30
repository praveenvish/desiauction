import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encryptPushPayload,
  generateVapidKeys,
  isPushServiceEndpoint,
  sendWebPush,
  vapidAuthorization,
  type PushTransport,
} from "./web-push";

/**
 * Web push by hand (PR18): the RFC 8291 test vector byte for byte, a round
 * trip through the browser's side of the decryption, a VAPID signature that
 * verifies, and "gone" for a subscription the push service has dropped.
 */

const b = (text: string) => Buffer.from(text, "base64url");

/** The browser's side (RFC 8291 §3.4), to prove what we send can be read. */
function decryptAsBrowser(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20] ?? 0;
  const asPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, info, 32));
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // Strip the padding delimiter (0x02) and anything after it.
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

describe("RFC 8291 message encryption", () => {
  it("matches the RFC's own example byte for byte", () => {
    const ephemeral = createECDH("prime256v1");
    ephemeral.setPrivateKey(b("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"));
    const body = encryptPushPayload(
      {
        p256dh:
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      Buffer.from("When I grow up, I want to be a watermelon"),
      { ephemeral, salt: b("DGv6ra1nlYgDCS1FRnbzlw") },
    );
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("round-trips through the browser's decryption with fresh keys", () => {
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const auth = Buffer.from("0123456789abcdef");
    const message = JSON.stringify({ title: "DesiAuction", body: "You were sold at auction" });
    const body = encryptPushPayload(
      { p256dh: browser.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
      Buffer.from(message),
    );
    expect(decryptAsBrowser(body, browser.getPrivateKey(), browser.getPublicKey(), auth)).toBe(
      message,
    );
  });
});

describe("VAPID", () => {
  it("signs a JWT for the push service's origin that verifies with our public key", () => {
    const keys = { ...generateVapidKeys(), subject: "mailto:support@desiauction.in" };
    const header = vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      keys,
      Date.UTC(2026, 8, 28),
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head = "", claims = "", signature = "", k = ""] = match ?? [];
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(b(claims).toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Date.UTC(2026, 8, 28) / 1000 + 12 * 60 * 60,
      sub: "mailto:support@desiauction.in",
    });
    const publicKey = b(keys.publicKey);
    const key = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: publicKey.subarray(1, 33).toString("base64url"),
        y: publicKey.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${head}.${claims}`),
        { key, dsaEncoding: "ieee-p1363" },
        b(signature),
      ),
    ).toBe(true);
  });
});

describe("sendWebPush", () => {
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  const subscription = {
    endpoint: "https://updates.push.services.mozilla.com/wpush/v2/xyz",
    p256dh: browser.getPublicKey().toString("base64url"),
    auth: Buffer.from("0123456789abcdef").toString("base64url"),
  };
  const keys = { ...generateVapidKeys(), subject: "mailto:support@desiauction.in" };
  const answering =
    (status: number, seen?: (headers: Record<string, string>) => void): PushTransport =>
    (_url, init) => {
      seen?.(init.headers);
      return Promise.resolve({ status, body: "" });
    };

  it("posts an aes128gcm body with VAPID auth and a TTL", async () => {
    let headers: Record<string, string> = {};
    expect(
      await sendWebPush(subscription, { title: "t" }, keys, {
        transport: answering(201, (h) => {
          headers = h;
        }),
      }),
    ).toBe("sent");
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers["authorization"]).toMatch(/^vapid t=/);
    expect(headers["ttl"]).toBe("86400");
  });

  it("says gone for a subscription the push service dropped, failed otherwise", async () => {
    expect(await sendWebPush(subscription, {}, keys, { transport: answering(410) })).toBe("gone");
    expect(await sendWebPush(subscription, {}, keys, { transport: answering(404) })).toBe("gone");
    expect(await sendWebPush(subscription, {}, keys, { transport: answering(500) })).toBe("failed");
  });

  it("never calls an address that is not a push service — and does not forget the row either", async () => {
    let called = 0;
    const counting: PushTransport = () => {
      called += 1;
      return Promise.resolve({ status: 201, body: "" });
    };
    for (const endpoint of [
      "https://attacker.example/collect",
      "https://169.254.169.254/latest/meta-data/",
      "https://db:5432/",
    ]) {
      expect(
        await sendWebPush({ ...subscription, endpoint }, {}, keys, { transport: counting }),
      ).toBe("failed");
    }
    expect(called).toBe(0);
  });

  it("refuses to follow a redirect", async () => {
    let redirect: string | undefined;
    const transport: PushTransport = (_url, init) => {
      redirect = init.redirect;
      return Promise.resolve({ status: 201, body: "" });
    };
    await sendWebPush(subscription, {}, keys, { transport });
    expect(redirect).toBe("error");
  });

  it("answers failed, not a throw, for keys that are not a P-256 point", async () => {
    expect(
      await sendWebPush({ ...subscription, p256dh: "AAAA" }, {}, keys, {
        transport: answering(201),
      }),
    ).toBe("failed");
  });
});

describe("isPushServiceEndpoint", () => {
  it("admits the browsers' own push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/xyz",
      "https://wns2-pn1p.notify.windows.com/w/?token=abc",
      "https://web.push.apple.com/QGuQ",
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it("refuses everything else", () => {
    for (const endpoint of [
      "not a url",
      "http://fcm.googleapis.com/fcm/send/abc", // plain http
      "https://fcm.googleapis.com:8443/fcm/send/abc", // another port
      "https://user:pass@fcm.googleapis.com/fcm/send/abc", // credentials
      "https://fcm.googleapis.com.attacker.example/x", // suffix on the wrong side
      "https://notify.windows.com.attacker.example/x",
      "https://evilnotify.windows.com/x", // no dot before the suffix
      "https://localhost/x",
      "https://10.0.0.5/x",
      "https://attacker.example/?h=fcm.googleapis.com",
      `https://fcm.googleapis.com/${"a".repeat(3000)}`, // unbounded
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(false);
    }
  });
});
