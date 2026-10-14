export type InsightQuery = Record<string, string | string[] | undefined>;
const keys = ["view", "ballType", "timeOfDay", "formatKey", "pitch", "groundType"] as const;
/** Carry only bounded single selections through filters, tabs and authentication. */
export function boundedInsightQuery(query: InsightQuery): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = query[key];
    if (typeof value !== "string" || !value.length || value.length > 40) continue;
    if (key === "view" && value !== "batting" && value !== "bowling") continue;
    result[key] = value;
  }
  return result;
}
export function insightHref(
  basePath: string,
  query: InsightQuery,
  changes: Record<string, string> = {},
) {
  const selected = boundedInsightQuery({ ...boundedInsightQuery(query), ...changes });
  const parameters = new URLSearchParams(selected);
  return parameters.size ? `${basePath}?${parameters.toString()}` : basePath;
}
