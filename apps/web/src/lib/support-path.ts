export const TOKEN_ROUTE_PREFIXES = ["join", "owner-join", "demo", "review", "handover"] as const;
export const REDACTED = "[redacted]";

/** Shared server/client display rule. Canonical season fixture numbers are public. */
export function redactSupportPath(pathname: string): string {
  const segments = pathname.split("/");
  for (let index = 1; index < segments.length - 1; index += 1) {
    const bearer =
      (index === 1 && segments[index] === "m") ||
      (index === 2 && segments[1] === "match" && segments[index] === "confirm") ||
      (TOKEN_ROUTE_PREFIXES as readonly string[]).includes(segments[index] ?? "");
    if (bearer && segments[index + 1]) segments[index + 1] = REDACTED;
  }
  return segments.join("/");
}
