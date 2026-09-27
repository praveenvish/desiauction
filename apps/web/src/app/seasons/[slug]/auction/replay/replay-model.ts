/**
 * THE REPLAY, AS A NIGHT RATHER THAN A LOG (2026-09-27) — pure, so it is tested.
 *
 * The event log is 800 rows for a small auction. People do not remember an
 * auction by its events; they remember it by its LOTS: who came up, who fought
 * over them, who won. So the log is read here into chapters — one per time a
 * lot went on the block (a lot passed in round one and sold in round two is two
 * chapters) — and everything the screen draws is derived from those: the lot
 * list, the bidding line, the chapter bar, the night's summary.
 *
 * The screen still folds the log with core's own reducer for the moment it is
 * showing (that is the proof the replay exists for); this file only names the
 * moments.
 */

export interface ReplayEvent {
  readonly seq: number;
  readonly type: string;
  readonly atMs: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface Chapter {
  readonly lotId: string;
  /** The step (1-based event count) at which the lot went on the block. */
  readonly openAt: number;
  /** The step of its hammer, or null while it is still on the block. */
  readonly endAt: number | null;
  /** 1 for the lot's first time up, 2 for its re-run, … */
  readonly round: number;
  readonly result: { sold: true; paddleId: string; amount: number } | { sold: false } | null;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** Every time a lot went on the block, in order, with how it ended. */
export function chaptersOf(events: readonly ReplayEvent[]): Chapter[] {
  const chapters: Chapter[] = [];
  const open = new Map<string, number>(); // lotId → index into chapters
  const rounds = new Map<string, number>();
  events.forEach((event, index) => {
    const step = index + 1;
    const lotId = str(event.payload["lotId"]);
    if (lotId === null) {
      return;
    }
    if (event.type === "LotOpened") {
      const round = (rounds.get(lotId) ?? 0) + 1;
      rounds.set(lotId, round);
      open.set(lotId, chapters.length);
      chapters.push({ lotId, openAt: step, endAt: null, round, result: null });
      return;
    }
    if (event.type === "LotSold" || event.type === "LotUnsold") {
      const at = open.get(lotId);
      const chapter = at === undefined ? undefined : chapters[at];
      if (at === undefined || chapter === undefined) {
        return;
      }
      const paddleId = str(event.payload["paddleId"]);
      const amount = num(event.payload["amount"]);
      chapters[at] = {
        ...chapter,
        endAt: step,
        result:
          event.type === "LotSold" && paddleId !== null && amount !== null
            ? { sold: true, paddleId, amount }
            : { sold: false },
      };
      open.delete(lotId);
    }
  });
  return chapters;
}

/**
 * The chapter a step belongs to: the one on the block at that step, else the
 * last one to have ended by then (so the screen shows its verdict). Null
 * before the first lot opens.
 */
export function chapterAt(chapters: readonly Chapter[], step: number): Chapter | null {
  let latest: Chapter | null = null;
  for (const chapter of chapters) {
    if (chapter.openAt > step) {
      break;
    }
    latest = chapter;
  }
  return latest;
}

/** Where each LOT stands at a step: its latest chapter's word. */
export type LotState = "waiting" | "bidding" | "sold" | "unsold";

export interface LotRow {
  readonly lotId: string;
  readonly state: LotState;
  /** The latest chapter's result at this step (sold carries team and price). */
  readonly result: Chapter["result"];
  /** The step to jump to for this lot: its latest opening up to now, else its first. */
  readonly jumpTo: number | null;
  readonly rounds: number;
}

/** Every lot, in the order it first came up (then the ones that never did), at a step. */
export function lotRowsAt(
  chapters: readonly Chapter[],
  lotOrder: readonly string[],
  step: number,
): LotRow[] {
  const byLot = new Map<string, Chapter[]>();
  for (const chapter of chapters) {
    const list = byLot.get(chapter.lotId) ?? [];
    list.push(chapter);
    byLot.set(chapter.lotId, list);
  }
  const firstOpen = (lotId: string) => byLot.get(lotId)?.[0]?.openAt ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...lotOrder].sort((a, b) => firstOpen(a) - firstOpen(b));
  return ordered.map((lotId) => {
    const all = byLot.get(lotId) ?? [];
    const seen = all.filter((chapter) => chapter.openAt <= step);
    const latest = seen[seen.length - 1];
    if (latest === undefined) {
      return { lotId, state: "waiting", result: null, jumpTo: all[0]?.openAt ?? null, rounds: 0 };
    }
    const ended = latest.endAt !== null && latest.endAt <= step;
    return {
      lotId,
      state: !ended ? "bidding" : latest.result?.sold === true ? "sold" : "unsold",
      result: ended ? latest.result : null,
      jumpTo: latest.openAt,
      rounds: seen.length,
    };
  });
}

export interface WarPoint {
  readonly amount: number;
  readonly paddleId: string;
}

/** Every accepted bid in a chapter up to a step — the bidding line. */
export function bidsIn(events: readonly ReplayEvent[], chapter: Chapter, step: number): WarPoint[] {
  const last = Math.min(step, chapter.endAt ?? step);
  const points: WarPoint[] = [];
  for (let index = chapter.openAt; index < last; index += 1) {
    const event = events[index];
    if (event === undefined || event.type !== "BidAccepted") {
      continue;
    }
    if (str(event.payload["lotId"]) !== chapter.lotId) {
      continue;
    }
    const amount = num(event.payload["amount"]);
    const paddleId = str(event.payload["paddleId"]);
    if (amount !== null && paddleId !== null) {
      points.push({ amount, paddleId });
    }
  }
  return points;
}

export interface NightSummary {
  readonly sold: number;
  readonly unsold: number;
  readonly lots: number;
  /** Opened to closed, in whole minutes; null without both events. */
  readonly minutes: number | null;
  /** The biggest sales, by each lot's final result. */
  readonly top: readonly { lotId: string; paddleId: string; amount: number; at: number }[];
  /** Per paddle: how many lots it finally bought. */
  readonly bought: Readonly<Record<string, number>>;
}

/** The night as it finished — every lot counted once, by its last hammer. */
export function summaryOf(
  events: readonly ReplayEvent[],
  chapters: readonly Chapter[],
  lotsTotal: number,
  upto: number = events.length,
): NightSummary {
  const final = new Map<string, Chapter>();
  for (const chapter of chapters) {
    if (chapter.endAt !== null && chapter.endAt <= upto) {
      final.set(chapter.lotId, chapter);
    }
  }
  let sold = 0;
  const bought: Record<string, number> = {};
  const top: { lotId: string; paddleId: string; amount: number; at: number }[] = [];
  for (const chapter of final.values()) {
    if (chapter.result?.sold === true) {
      sold += 1;
      bought[chapter.result.paddleId] = (bought[chapter.result.paddleId] ?? 0) + 1;
      top.push({
        lotId: chapter.lotId,
        paddleId: chapter.result.paddleId,
        amount: chapter.result.amount,
        at: chapter.openAt,
      });
    }
  }
  top.sort((a, b) => b.amount - a.amount);
  const opened = events.find((event) => event.type === "AuctionOpened")?.atMs;
  const closed = events.find((event) => event.type === "AuctionClosed")?.atMs;
  return {
    sold,
    unsold: final.size - sold,
    lots: lotsTotal,
    minutes:
      opened !== undefined && closed !== undefined
        ? Math.max(1, Math.round((closed - opened) / 60_000))
        : null,
    top: top.slice(0, 3),
    bought,
  };
}
