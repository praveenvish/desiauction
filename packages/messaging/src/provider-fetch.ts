/**
 * THE ONE WAY A MESSAGE PROVIDER IS CALLED OVER HTTP.
 *
 * Every sender in this product — the OTP and code mailers, the transactional
 * mailer, MSG91 Flow, the WhatsApp Cloud API, the finops email adapter — used a
 * bare `fetch` with no deadline. A provider that accepted the connection and
 * then said nothing held the caller for as long as the socket lived.
 *
 * On a request that is a slow page. In the outbox drain it is a DOUBLE SEND:
 * the drain claims rows for a five-minute lease and sends them one after the
 * other, so a handful of stalled calls outlast the lease, the next drain
 * re-claims the rows still waiting, and both drains deliver them. A deadline
 * far inside the lease is what makes the lease mean anything (outbox.ts).
 *
 * Ten seconds: every provider on the table answers in well under one, and a
 * code the person is waiting for is useless after ten anyway.
 */
export const PROVIDER_TIMEOUT_MS = 10_000;

export interface ProviderResponse {
  readonly status: number;
  readonly body: string;
  /**
   * Lower-cased response headers. Optional so every existing test fake stays
   * valid; SES is the one reader (it names its errors in `x-amzn-errortype`).
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * `fetch` with the deadline applied to the WHOLE exchange — the signal also
 * aborts a body that trickles in after the headers, which is where a
 * half-dead provider tends to stall.
 */
export async function providerFetch(
  url: string,
  /** A binary body is a web push (web-push.ts): encrypted bytes, never text. */
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string | Uint8Array<ArrayBuffer>;
  },
  /** Tests shorten it; nothing else should. */
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<ProviderResponse> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  return {
    status: response.status,
    body: await response.text(),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

/**
 * Did the call die on our deadline rather than on the network?
 *
 * The distinction matters to exactly one caller. A refused connection means the
 * provider never had the message; a timeout means it may well have accepted it
 * and simply not answered in time — "unknown", not "failed". Sending it again
 * somewhere else is how a person gets the same moment twice.
 */
export function isProviderTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
