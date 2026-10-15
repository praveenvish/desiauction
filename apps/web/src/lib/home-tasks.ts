/** A recommendation is a permitted destination, never permission to perform a write. */
export interface HomeTask {
  id: string;
  kind: "conduct" | "score" | "owner" | "lineup" | "confirm" | "finance" | "operator" | "receipt";
  scope: {
    orgId?: string;
    competitionId?: string;
    teamId?: string;
    fixtureId?: string;
    caseId?: string;
  };
  priority:
    "conduct-live" | "score-held" | "owner-live" | "today" | "prepare" | "waiting" | "result";
  /** Only an actual reader-supplied due/kickoff time. Null never means overdue. */
  dueAt: string | null;
  state: string;
  title: string;
  context: string;
  explanation: string;
  action: string;
  href: string;
  completion: string;
  retention: "scoring-queue" | "server" | "read-only";
}

const PRIORITY: Record<HomeTask["priority"], number> = {
  "conduct-live": 0,
  "score-held": 1,
  "owner-live": 2,
  today: 3,
  prepare: 4,
  waiting: 5,
  result: 6,
};

export function rankHomeTasks(tasks: readonly HomeTask[]): HomeTask[] {
  return [...tasks].sort(
    (a, b) =>
      PRIORITY[a.priority] - PRIORITY[b.priority] ||
      (a.dueAt === b.dueAt
        ? 0
        : a.dueAt === null
          ? 1
          : b.dueAt === null
            ? -1
            : a.dueAt.localeCompare(b.dueAt)) ||
      a.id.localeCompare(b.id),
  );
}

/** Shared Home/menu scope order, independent of query result or array position. */
export function rankLiveScopes<T extends { seasonSlug: string; teamId?: string; live: boolean }>(
  scopes: readonly T[],
): T[] {
  return [...scopes].sort(
    (a, b) =>
      Number(b.live) - Number(a.live) ||
      a.seasonSlug.localeCompare(b.seasonSlug) ||
      (a.teamId ?? "").localeCompare(b.teamId ?? ""),
  );
}
