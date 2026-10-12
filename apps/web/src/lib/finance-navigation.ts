/** Presentation-only register selection; every destination retains its current authority gate. */
type Selection = Pick<URLSearchParams, "getAll">;
const fields = ["view", "kind", "q"] as const;
function boundedQuery(params: Selection): string {
  const query = new URLSearchParams();
  for (const name of fields) {
    const values = params.getAll(name);
    const value = values[0];
    if (values.length === 1 && value && value.length <= 1024) {
      const candidate = new URLSearchParams(query);
      candidate.set(name, value);
      if (candidate.toString().length <= 4096) query.set(name, value);
    }
  }
  return query.toString();
}
export function financeDocumentHref(slug: string, docId: string, params: Selection): string {
  const query = boundedQuery(params);
  const destination = `/org/${encodeURIComponent(slug)}/money/documents/${encodeURIComponent(docId)}`;
  return query
    ? `${destination}?${new URLSearchParams({ register: query }).toString()}`
    : destination;
}
export function financeRegisterReturn(
  slug: string,
  selection: string | string[] | undefined,
): string {
  const destination = `/org/${encodeURIComponent(slug)}/money`;
  if (typeof selection !== "string" || selection.length > 4096) return destination;
  const query = boundedQuery(new URLSearchParams(selection));
  return query ? `${destination}?${query}` : destination;
}
