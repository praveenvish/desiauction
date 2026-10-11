import type { Phase, TrustLevel } from "@desiauction/core/scoring";
export type ProblemKind = "stalled" | "quiet" | "lineup" | "scorer" | "review";
export interface TodayFixtureFacts {
  id: string;
  number: string;
  kickoffAt: string | null;
  status: string;
  home: string;
  away: string;
  ground: string | null;
  groundId: string | null;
  phase: Phase | null;
  finishedAt: string | null;
  trust: TrustLevel | null;
  lastReceiptAt: string | null;
  startedAt: string | null;
  createdAt: string | null;
  playing: boolean;
  missingLineups: string[];
  scorerAssigned: boolean;
  scorerName: string | null;
  viewerPeak: number;
  score: string | null;
  conditions: string;
  situation: string;
  progress: { value: number; max: number } | null;
  quota: "finite" | "unlimited" | "unavailable";
}
export interface TodayRow extends TodayFixtureFacts {
  date: string | null;
  reasons: { kind: ProblemKind; text: string }[];
  action: { label: string; href: string };
}
export function kickoffInstant(value: string | null): number | null {
  if (!value) return null;
  const stamp = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}+05:30`);
  return Number.isFinite(stamp) ? stamp : null;
}
const TERMINAL = new Set<Phase>([
  "result_reached",
  "finished",
  "final",
  "no_result",
  "abandoned",
  "walkover",
  "void",
]);
export function fixtureProblems(fixture: TodayFixtureFacts, now: Date, today: string) {
  const reasons: TodayRow["reasons"] = [];
  const terminal =
    fixture.status === "completed" || (fixture.phase !== null && TERMINAL.has(fixture.phase));
  const receipt = fixture.lastReceiptAt ?? fixture.startedAt ?? fixture.createdAt;
  if (!terminal && !fixture.finishedAt && fixture.phase === "stalled")
    reasons.push({ kind: "stalled", text: "Scoring stalled" });
  else if (
    !terminal &&
    !fixture.finishedAt &&
    fixture.phase === "live" &&
    receipt &&
    now.getTime() - Date.parse(receipt) >= 15 * 60000
  )
    reasons.push({ kind: "quiet", text: "No delivery received for 15 minutes" });
  const kickoff = kickoffInstant(fixture.kickoffAt);
  const isToday = fixture.kickoffAt?.slice(0, 10) === today;
  if (
    isToday &&
    !terminal &&
    !fixture.playing &&
    kickoff !== null &&
    kickoff - now.getTime() <= 60 * 60000 &&
    fixture.missingLineups.length
  )
    reasons.push({
      kind: "lineup",
      text: `${fixture.missingLineups.join(" and ")} · lineup not recorded`,
    });
  if (isToday && !terminal && !fixture.scorerAssigned)
    reasons.push({ kind: "scorer", text: "No scorer assigned" });
  if (
    fixture.finishedAt &&
    now.getTime() - Date.parse(fixture.finishedAt) > 24 * 3600000 &&
    fixture.trust !== "confirmed" &&
    fixture.trust !== "verified" &&
    fixture.phase !== "void"
  )
    reasons.push({
      kind: "review",
      text:
        fixture.trust === "flagged"
          ? "Result needs review · flagged"
          : "Result unconfirmed for over 24 hours",
    });
  return reasons;
}
const priority: Record<ProblemKind, number> = {
  stalled: 0,
  quiet: 0,
  lineup: 1,
  scorer: 2,
  review: 3,
};
export function todayModel(fixtures: TodayFixtureFacts[], slug: string, today: string, now: Date) {
  const base = `/seasons/${encodeURIComponent(slug)}/fixtures`;
  const rows: TodayRow[] = [];
  const seen = new Set<string>();
  for (const fixture of fixtures) {
    if (seen.has(fixture.id)) continue;
    seen.add(fixture.id);
    if (
      !["published", "in_progress", "completed"].includes(fixture.status) ||
      fixture.phase === "void"
    )
      continue;
    const date = fixture.kickoffAt?.slice(0, 10) ?? null;
    const reasons = fixtureProblems(fixture, now, today);
    if (
      date !== today &&
      !(
        date !== null &&
        date < today &&
        reasons.some((reason) => ["quiet", "stalled", "review"].includes(reason.kind))
      )
    )
      continue;
    const problem = reasons[0]?.kind;
    const action =
      problem === "quiet" || problem === "stalled"
        ? { label: "Open scoring", href: `/score/${fixture.id}` }
        : problem === "lineup" || problem === "scorer"
          ? { label: "Open setup", href: `/score/${fixture.id}/setup` }
          : {
              label:
                fixture.finishedAt || fixture.status === "completed"
                  ? "Review result"
                  : "Open match",
              href: `${base}?match=${encodeURIComponent(fixture.id)}`,
            };
    rows.push({ ...fixture, date, reasons, action });
  }
  const matches = rows
    .filter((row) => row.date === today)
    .sort(
      (left, right) =>
        (left.kickoffAt ?? "").localeCompare(right.kickoffAt ?? "") ||
        left.number.localeCompare(right.number),
    );
  const problems = rows
    .filter((row) => row.reasons.length)
    .sort(
      (left, right) =>
        priority[left.reasons[0]?.kind ?? "review"] -
          priority[right.reasons[0]?.kind ?? "review"] ||
        (left.kickoffAt ?? "").localeCompare(right.kickoffAt ?? ""),
    );
  return {
    date: today,
    matches,
    problems,
    viewerPeaks: matches.reduce((sum, row) => sum + row.viewerPeak, 0),
    liveCount: matches.filter((row) => row.phase === "live").length,
    groundCount: new Set(matches.map((row) => row.groundId).filter((ground) => ground !== null))
      .size,
  };
}
