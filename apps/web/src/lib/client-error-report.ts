/**
 * WHAT A BROWSER TELLS US WHEN SOMETHING BREAKS IN IT (PRR 2026-09-29).
 *
 * Until this existed the product could not see a failure that happened in the
 * browser at all. Error tracking was initialised on the server only, so a
 * crash in the auction room showed the person "Something broke on our side",
 * with no code to quote (a client error carries no digest) — and told nobody
 * on our side anything. The first an operator heard of a broken room was a
 * phone call.
 *
 * Deliberately small: no third-party script and no new dependency. The report
 * is a same-origin POST to `/api/client-error`, which writes one scrubbed log
 * line. Shared by the sender and the receiver so neither can drift.
 */

/** The most one page load may send, however badly it is doing. */
export const MAX_REPORTS_PER_PAGE = 5;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_STACK_LENGTH = 2_000;

export type ClientErrorSource = "boundary" | "root-boundary" | "window" | "promise";

export interface ClientErrorReport {
  readonly source: ClientErrorSource;
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
  /** Next's server-error digest, when the failure began on the server. */
  readonly digest: string | null;
  /** Path only — never the query string, which is where tokens travel. */
  readonly path: string;
}

const clip = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

/**
 * Anything that can be thrown, as a report. `throw "text"` and `throw null`
 * are both legal, so nothing here assumes an Error.
 */
export function describeClientError(
  thrown: unknown,
  source: ClientErrorSource,
  path: string,
): ClientErrorReport {
  const error =
    typeof thrown === "object" && thrown !== null ? (thrown as Record<string, unknown>) : {};
  const text = (value: unknown): string | null =>
    typeof value === "string" && value !== "" ? value : null;
  const message = text(error["message"]) ?? (typeof thrown === "string" ? thrown : "(no message)");
  const stack = text(error["stack"]);
  return {
    source,
    name: clip(text(error["name"]) ?? typeof thrown, 80),
    message: clip(message, MAX_MESSAGE_LENGTH),
    stack: stack === null ? null : clip(stack, MAX_STACK_LENGTH),
    digest: text(error["digest"]),
    path: clip(path.split("?")[0]?.split("#")[0] ?? "", 200),
  };
}

/** Narrow an untrusted body to a report, or refuse it. */
export function parseClientErrorReport(body: unknown): ClientErrorReport | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const source = record["source"];
  if (
    source !== "boundary" &&
    source !== "root-boundary" &&
    source !== "window" &&
    source !== "promise"
  ) {
    return null;
  }
  const required = (key: string, limit: number): string | null => {
    const value = record[key];
    return typeof value === "string" && value !== "" ? clip(value, limit) : null;
  };
  const optional = (key: string, limit: number): string | null => {
    const value = record[key];
    return typeof value === "string" && value !== "" ? clip(value, limit) : null;
  };
  const message = required("message", MAX_MESSAGE_LENGTH);
  const path = required("path", 200);
  if (message === null || path === null || !path.startsWith("/")) {
    return null;
  }
  return {
    source,
    name: optional("name", 80) ?? "Error",
    message,
    stack: optional("stack", MAX_STACK_LENGTH),
    digest: optional("digest", 80),
    path: path.split("?")[0]?.split("#")[0] ?? "/",
  };
}
