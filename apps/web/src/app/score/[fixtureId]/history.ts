import type { MatchEvent } from "@desiauction/core/scoring";
import { SyncRefusal } from "./sync-refusal";
export async function readHistory(
  fixtureId: string,
  fetcher: typeof fetch = fetch,
): Promise<{
  events: MatchEvent[];
  attempt: number;
  lastSeq: number;
}> {
  const events: MatchEvent[] = [];
  let since = 0;
  for (;;) {
    const response = await fetcher(`/api/score/${fixtureId}/events?since=${String(since)}`);
    const body = (await response.json()) as {
      events?: MatchEvent[];
      attempt: number;
      lastSeq: number;
      message?: string;
    };
    if (!response.ok || !body.events)
      throw new SyncRefusal(body.message ?? "Could not reload this match.");
    events.push(...body.events);
    const last = body.events.at(-1);
    if (body.lastSeq <= (last?.seq ?? since))
      return { events, attempt: body.attempt, lastSeq: body.lastSeq };
    if (!last || last.seq <= since) throw new Error("Match history did not advance.");
    since = last.seq;
  }
}
