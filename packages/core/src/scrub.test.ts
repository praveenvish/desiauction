import { describe, expect, it } from "vitest";

import { REDACTED, scrub, scrubError, scrubText } from "./scrub";

describe("scrub", () => {
  it("redacts a phone number inside an error message", () => {
    // The real one: a unique-violation message carries the value that collided.
    const message =
      'duplicate key value violates unique constraint "people_phone_uq" Key (phone)=(+919999000001) already exists';
    expect(scrubText(message)).not.toContain("9999000001");
    expect(scrubText(message)).toContain("[phone]");
  });

  it("redacts emails and provider keys in free text", () => {
    expect(scrubText("mail to owner@club.example failed")).toContain("[email]");
    expect(scrubText("using rzp_live_ABCDEF123456")).toContain("[key]");
  });

  it("redacts the SMS provider URL a fetch span records — code and number both", () => {
    // MSG91 takes the OTP and the mobile in the query string; Sentry's outgoing
    // fetch spans carry that URL as url.full / url.query.
    const url =
      "https://control.msg91.com/api/v5/otp?template_id=abc&mobile=919876543210&otp=482913&otp_expiry=5";
    const out = scrubText(url);
    expect(out).not.toContain("482913");
    expect(out).not.toContain("9876543210");
    expect(out).toContain("template_id=abc");
    expect(scrubText("mobile=919876543210&otp=482913")).not.toContain("482913");
    // The engine's WebSocket admission ticket rides the query string too.
    expect(scrubText("wss://engine.example/ws?auction=A1&ticket=eyJhbGciOi.xyz")).not.toContain(
      "eyJhbGciOi",
    );
  });

  it("redacts a bare 91-prefixed mobile but not ordinary long numbers", () => {
    expect(scrubText("to 919876543210 failed")).toContain("[phone]");
    expect(scrubText("amount 2500000 paise")).toBe("amount 2500000 paise");
  });

  it("redacts capability-link tokens in paths", () => {
    for (const path of ["/join/AbC123xyz", "/owner-join/t0k3n", "/demo/h4ndle", "/review/r3v"]) {
      const out = scrubText(`GET https://desiauction.in${path}?x=1`);
      expect(out).toContain("[token]");
      expect(out).not.toContain(path.split("/")[2]);
    }
  });

  it("redacts sensitive fields by name, at any depth", () => {
    const scrubbed = scrub({
      ok: true,
      input: { phone: "+919999000002", note: "fine" },
      headers: { authorization: "Bearer abc" },
    }) as Record<string, Record<string, unknown>>;
    expect(scrubbed["input"]?.["phone"]).toBe(REDACTED);
    expect(scrubbed["input"]?.["note"]).toBe("fine");
    expect(scrubbed["headers"]?.["authorization"]).toBe(REDACTED);
  });

  it("keeps the things an incident is actually diagnosed from", () => {
    // A scrub that ate ids and money would make the report useless — the
    // failure mode opposite to the one it exists to prevent.
    const kept = scrub({
      auctionId: "01M1FZ9EN906SRHSH2MVW1EZTN",
      amount: 2_500_000,
      lotNumber: "L001",
    }) as Record<string, unknown>;
    expect(kept["auctionId"]).toBe("01M1FZ9EN906SRHSH2MVW1EZTN");
    expect(kept["amount"]).toBe(2_500_000);
    expect(kept["lotNumber"]).toBe("L001");
  });

  it("survives a cycle rather than throwing on the way to the tracker", () => {
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    expect(() => scrub(a)).not.toThrow();
  });
});

describe("scrubError — an error made safe for a log line, and still useful in one", () => {
  // What pino's stdSerializers.err produces for a postgres unique violation.
  const serialized = {
    type: "PostgresError",
    message: 'duplicate key value violates unique constraint "people_phone_unique"',
    stack: "PostgresError: duplicate key value\n    at handle (connection.js:1:1)",
    code: "23505",
    detail: "Key (phone)=(+919876543210) already exists.",
    table_name: "people",
  };

  it("removes the phone number the database wrote into the detail", () => {
    const out = JSON.stringify(scrubError(serialized));
    expect(out).not.toContain("9876543210");
    expect(out).toContain("[phone]");
    expect(out).toContain("people_phone_unique");
  });

  it("keeps the error's own code, under a key the redaction does not censor", () => {
    expect(scrubError(serialized)).toMatchObject({ errorCode: "23505", code: "[redacted]" });
    expect(scrubError({ type: "Error", message: "x", code: "ECONNREFUSED" })).toMatchObject({
      errorCode: "ECONNREFUSED",
    });
    expect(scrubError({ type: "Error", message: "x", code: "ERR_SOCKET_CLOSED" })).toMatchObject({
      errorCode: "ERR_SOCKET_CLOSED",
    });
  });

  it("does not carry across a code that is not shaped like an error code", () => {
    // A one-time code, or anything else that happens to be called `code`.
    for (const code of ["482913", "hunter2", "ab", 23505, undefined]) {
      expect(scrubError({ message: "x", code })).not.toHaveProperty("errorCode");
    }
  });

  it("passes through what is not an object", () => {
    expect(scrubError("call +919876543210")).toBe("call [phone]");
    expect(scrubError(null)).toBeNull();
  });
});

describe("an address is redacted; a package version is not", () => {
  it("still redacts every shape an address takes", () => {
    for (const address of [
      "asha@example.com",
      "asha.k+league@mail.example.co.in",
      "a_b-c@sub.domain.org",
      "UPPER@EXAMPLE.IN",
    ]) {
      expect(scrubText(`mail to ${address} failed`), address).toBe("mail to [email] failed");
    }
  });

  it("leaves the frames of a stack trace readable", () => {
    const frame =
      "at run (/app/node_modules/.pnpm/next@15.5.25_react-dom@19.2.7/node_modules/next/dist/server.js:12:3)";
    expect(scrubText(frame)).toBe(frame);
    const scoped =
      "at x (node_modules/.pnpm/@vitest+runner@3.2.7/node_modules/@vitest/runner/a.js)";
    expect(scrubText(scoped)).toBe(scoped);
  });

  it("redacts an address sitting inside such a line", () => {
    expect(scrubText("next@15.5.25 could not mail asha@example.com")).toBe(
      "next@15.5.25 could not mail [email]",
    );
  });
});

describe("a URL that carries its own login", () => {
  it("loses the login and keeps the host, whatever the host looks like", () => {
    for (const [given, kept] of [
      [
        "postgres://desiauction:s3cr3t-value@db:5432/desiauction",
        "postgres://[credentials]@db:5432/desiauction",
      ],
      [
        "connect failed: postgres://app:pw@10.0.0.5:5432/x",
        "connect failed: postgres://[credentials]@10.0.0.5:5432/x",
      ],
      ["https://key:secret@api.example.com/v1", "https://[credentials]@api.example.com/v1"],
      ["redis://default:p%40ss@cache.internal:6379", "redis://[credentials]@cache.internal:6379"],
    ] as const) {
      expect(scrubText(given)).toBe(kept);
    }
  });

  it("leaves alone what only looks a little like one", () => {
    for (const text of [
      "https://example.com/a:b@c",
      "file:///srv/app/node_modules/.pnpm/next@15.5.25/node_modules/next/dist/server.js:12:3",
      "at handler (webpack-internal:///(rsc)/./src/server/auth/actions.ts:41:9)",
      "ratio 3:2@home",
    ]) {
      expect(scrubText(text)).toBe(text);
    }
  });
});
