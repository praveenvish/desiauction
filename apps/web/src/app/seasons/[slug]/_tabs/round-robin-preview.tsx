import { IconSpark, SectionCard, VisuallyHidden } from "@desiauction/ui";

import { TeamCrest } from "./team-crest";

interface PreviewTeam {
  readonly id: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly primaryColor: string | null;
  readonly logoUrl: string | null;
}

/** Every pairing of a single round-robin, in team-list order. */
export function pairingsOf<T>(teams: readonly T[]): [T, T][] {
  const pairs: [T, T][] = [];
  teams.forEach((home, index) => {
    for (const away of teams.slice(index + 1)) {
      pairs.push([home, away]);
    }
  });
  return pairs;
}

/**
 * THE SCHEDULE THESE TEAMS WILL MAKE (round 5A).
 *
 * Fixtures, Lineups, Calendar and Match day each ended on one "nothing yet"
 * card while the season had no matches. The next object is the same on all
 * four: every pairing the round-robin generator will make of this season's
 * teams — read from the team list the generator reads, nothing invented.
 */
export function RoundRobinPreview({
  teams,
  title = "The round-robin these teams make",
  lede,
  testId = "fixtures-pairings",
}: {
  teams: readonly PreviewTeam[];
  title?: string;
  /** Said before the count ("3 teams · 3 matches in one round…"). */
  lede?: string;
  testId?: string;
}) {
  if (teams.length < 2) {
    return null;
  }
  const pairs = pairingsOf(teams);
  const count = `${String(teams.length)} teams · ${String(pairs.length)} ${pairs.length === 1 ? "match" : "matches"} in one round, every team against every other`;
  return (
    <SectionCard
      icon={<IconSpark />}
      concept="fixtures"
      title={title}
      description={lede === undefined ? count : `${lede} ${count}`}
      flush
      data-testid={testId}
    >
      <ul className="fx-pairings">
        {pairs.map(([home, away]) => (
          <li key={`${home.id}-${away.id}`}>
            <span className="fx-pair-side">
              <TeamCrest
                name={home.name}
                short={home.shortName}
                color={home.primaryColor}
                logoUrl={home.logoUrl}
              />
              <span className="fx-pair-name">{home.name}</span>
            </span>
            <span className="fx-pair-vs" aria-hidden>
              vs
            </span>
            <VisuallyHidden> against </VisuallyHidden>
            <span className="fx-pair-side fx-pair-away">
              <span className="fx-pair-name">{away.name}</span>
              <TeamCrest
                name={away.name}
                short={away.shortName}
                color={away.primaryColor}
                logoUrl={away.logoUrl}
              />
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
