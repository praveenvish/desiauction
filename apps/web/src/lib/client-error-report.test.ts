import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_LENGTH,
  MAX_STACK_LENGTH,
  describeClientError,
  parseClientErrorReport,
} from "./client-error-report";

describe("describing what a browser threw", () => {
  it("reads an Error, with Next's digest when there is one", () => {
    const error = Object.assign(new TypeError("cannot read x of undefined"), { digest: "123456" });
    expect(describeClientError(error, "boundary", "/seasons/cup/auction/live?x=1#y")).toMatchObject(
      {
        source: "boundary",
        name: "TypeError",
        message: "cannot read x of undefined",
        digest: "123456",
        // The query string is where tokens travel; it never leaves the browser.
        path: "/seasons/cup/auction/live",
      },
    );
  });

  it("copes with everything else that can legally be thrown", () => {
    expect(describeClientError("plain text", "promise", "/")).toMatchObject({
      name: "string",
      message: "plain text",
      stack: null,
    });
    for (const thrown of [null, undefined, 42, {}, { message: 7 }]) {
      const report = describeClientError(thrown, "window", "/home");
      expect(report.message).toBe("(no message)");
      expect(report.path).toBe("/home");
    }
  });

  it("clips what it sends", () => {
    const error = new Error("m".repeat(5_000));
    error.stack = "s".repeat(50_000);
    const report = describeClientError(error, "boundary", "/");
    expect(report.message.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH + 1);
    expect(report.stack?.length).toBeLessThanOrEqual(MAX_STACK_LENGTH + 1);
  });
});

describe("accepting a report from a stranger", () => {
  const good = { source: "boundary", name: "Error", message: "boom", path: "/home" };

  it("takes the fields it knows and nothing else", () => {
    expect(
      parseClientErrorReport({ ...good, stack: "at x", digest: "9", admin: true, __proto__: {} }),
    ).toEqual({
      source: "boundary",
      name: "Error",
      message: "boom",
      stack: "at x",
      digest: "9",
      path: "/home",
    });
  });

  it("refuses what is not a report", () => {
    for (const body of [
      null,
      "text",
      [],
      [good],
      {},
      { ...good, source: "somewhere-else" },
      { ...good, message: "" },
      { ...good, message: 5 },
      { ...good, path: "https://evil.example/x" },
      { ...good, path: "" },
    ]) {
      expect(parseClientErrorReport(body), JSON.stringify(body)).toBeNull();
    }
  });

  it("drops a query string that was sent anyway, and clips an oversized message", () => {
    const parsed = parseClientErrorReport({
      ...good,
      path: "/join/abc?token=secret",
      message: "m".repeat(9_000),
    });
    expect(parsed?.path).toBe("/join/abc");
    expect(parsed?.message.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH + 1);
  });
});
