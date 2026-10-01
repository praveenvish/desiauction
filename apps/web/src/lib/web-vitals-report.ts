/**
 * A CORE WEB VITALS SAMPLE FROM A REAL VISITOR (SEO-1 Phase 8).
 *
 * Lighthouse's lab LCP on the public pages (3.6–3.9s) turned out to be its
 * SIMULATION's estimate: in the unthrottled trace the largest paint IS the
 * first paint, on every page. Optimising against a model is guessing, so the
 * product measures the field instead — real phones, real networks — and the
 * budget in docs/57 is judged on that p75.
 *
 * Shared by the reporter (components/web-vitals-reporter.tsx) and the endpoint
 * (app/api/vitals/route.ts): a sample is only what is parsed here, nothing a
 * caller adds survives it. No user, no session, no query string.
 */
export const VITAL_NAMES = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type VitalName = (typeof VITAL_NAMES)[number];

export interface VitalSample {
  readonly name: VitalName;
  /** Milliseconds, except CLS, which is unitless. */
  readonly value: number;
  readonly rating: "good" | "needs-improvement" | "poor";
  /** The page's path, without its query string. */
  readonly path: string;
}

/** One page load in this many reports; enough for a p75, cheap on the network. */
export const SAMPLE_RATE = 0.1;

const RATINGS = new Set(["good", "needs-improvement", "poor"]);

export function parseVitalSample(body: unknown): VitalSample | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const { name, value, rating, path } = record;
  if (typeof name !== "string" || !(VITAL_NAMES as readonly string[]).includes(name)) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  // Past a minute (or a CLS of 100) is not a measurement, it is a tab left open.
  if (value > (name === "CLS" ? 100 : 60_000)) return null;
  if (typeof rating !== "string" || !RATINGS.has(rating)) return null;
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 200) return null;
  return {
    name: name as VitalName,
    value,
    rating: rating as VitalSample["rating"],
    path: path.split("?")[0] ?? "/",
  };
}

/** Any segment long enough to be a token or an id is not the page's shape. */
export function redactPath(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment.length >= 16 ? ":redacted" : segment))
    .join("/");
}
