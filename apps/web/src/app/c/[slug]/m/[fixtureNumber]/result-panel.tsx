import { publicFamilyPanel } from "@desiauction/core/scoring/panels";
import type { PublicScoringState as PublicLiveState } from "@desiauction/core/scoring";
import type {
  PublicResultDetails,
  PublicMatchAward,
} from "../../../../../server/scoring/result-details";

const BATTING = new Set(["runs", "fours", "sixes", "pace_vs_match", "duck"]);
const FIELDING = new Set(["catches", "stumpings", "run_out_direct", "run_out_assist"]);
function group(code: string): string {
  if (["goals", "assists", "points"].includes(code)) return "Scoring";
  if (code === "clean_sheet") return "Defending";
  if (["own_goals", "yellow_cards", "red_cards", "fouls"].includes(code)) return "Discipline";
  if (["raid_points", "super_raid", "super_10", "do_or_die", "tackled"].includes(code))
    return "Raiding";
  if (["tackle_points", "super_tackle", "high_5"].includes(code)) return "Defending";
  return BATTING.has(code) || code.startsWith("milestone_")
    ? "Batting"
    : FIELDING.has(code)
      ? "Fielding"
      : "Bowling";
}
function AwardIdentity({ award }: { award: PublicMatchAward }) {
  return (
    <div className="result-identity">
      {award.photoUrl ? (
        <img src={award.photoUrl} alt="" width={64} height={64} />
      ) : (
        <span className="result-initials" aria-hidden="true">
          {award.initials}
        </span>
      )}
      <div>
        <h3>{award.name}</h3>
        <p>{award.figures}</p>
      </div>
    </div>
  );
}
export function ResultPanel({
  live,
  details,
  slug,
  fixtureId,
  liveUrl,
  signedIn,
}: {
  live: PublicLiveState;
  details: PublicResultDetails | null | undefined;
  slug: string;
  fixtureId: string;
  liveUrl: string | null;
  signedIn: boolean;
}) {
  if (!live.result || live.phase === "void") return null;
  const familyPanel = publicFamilyPanel(live);
  const timed = familyPanel?.family === "timed" ? familyPanel.panel : null;
  const eligible = details?.seq === live.seq ? details : null;
  if (familyPanel?.family === "placement") {
    const frag = eligible?.awards.find((award) => award.kind === "top_fragger");
    return (
      <section className="result-panel" aria-label="Match awards" data-testid="result-panel">
        <h2>Top fragger</h2>
        {frag ? <AwardIdentity award={frag} /> : <p>No top fragger selected.</p>}
        {frag?.source === "organizer" ? (
          <p>Organizer selection · computed pick: {frag.computedName ?? "None"}</p>
        ) : null}
      </section>
    );
  }
  const pom = eligible?.awards.find((award) => award.kind === "player_of_match");
  const fighter = eligible?.awards.find((award) => award.kind === "fighter_of_match");
  const posterUrl = `/seasons/${encodeURIComponent(slug)}/posters/result/${encodeURIComponent(fixtureId)}?theme=stadium&size=portrait&download=1`;
  return (
    <section className="result-panel" aria-label="Match awards" data-testid="result-panel">
      {timed?.formatKey?.startsWith("football_") ? (
        <p>
          In-play penalty saves and misses are not tracked. Clean sheets use recorded appearances
          and the whole regulation score.
        </p>
      ) : timed?.formatKey?.startsWith("hockey_") ? (
        <p>Player awards are unavailable for hockey scoring.</p>
      ) : null}
      {pom ? (
        <article data-testid="result-pom" className="result-pom">
          <div className="result-award-heading">
            <div>
              <h2 className="result-kicker">Player of the Match</h2>
              <AwardIdentity award={pom} />
            </div>
            <p className="result-points">
              <strong>{pom.points.toFixed(1)}</strong>
              <span>points</span>
            </p>
          </div>
          {pom.source === "organizer" ? (
            <p className="result-selection">
              Organiser’s choice
              {pom.computedName ? ` · Computed pick: ${pom.computedName}` : " · No computed pick"}
            </p>
          ) : null}
          <div className="result-breakdown">
            {(live.family === "timed"
              ? ["Scoring", "Defending", "Discipline"]
              : live.family === "raid"
                ? ["Raiding", "Defending"]
                : ["Batting", "Bowling", "Fielding"]
            ).map((section) => {
              const lines = pom.lines.filter((line) => group(line.code) === section);
              if (!lines.length) return null;
              const total = lines.reduce((sum, line) => sum + line.points, 0);
              return (
                <section key={section}>
                  <h4>
                    {section} · {total.toFixed(1)}
                  </h4>
                  <dl>
                    {lines.map((line) => (
                      <div key={line.code}>
                        <dt>
                          {line.label}
                          {line.qty > 1 ? ` (${String(line.qty)})` : ""}
                        </dt>
                        <dd>
                          {line.points >= 0 ? "+" : ""}
                          {line.points.toFixed(1)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })}
          </div>
        </article>
      ) : (
        <p className="result-unavailable">
          {eligible
            ? "No Player of the Match selected."
            : "Award details are unavailable for this score update."}
        </p>
      )}
      {fighter ? (
        <article data-testid="result-fighter" className="result-fighter">
          <h2 className="result-kicker">Fighter of the Match</h2>
          <AwardIdentity award={fighter} />
          {fighter.source === "organizer" ? (
            <p className="result-selection">
              Organiser’s choice
              {fighter.computedName ? ` · Computed pick: ${fighter.computedName}` : ""}
            </p>
          ) : null}
        </article>
      ) : null}
      <p className="result-trust">{live.trust.replaceAll("_", " ")}</p>
      <div className="result-share">
        {live.family !== "raid" && live.family !== "timed" && (
          <a
            data-testid="result-share-poster"
            href={signedIn ? posterUrl : `/login?next=${encodeURIComponent(posterUrl)}`}
          >
            1080 × 1350 · Share poster
          </a>
        )}
        {liveUrl ? (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${live.result}\n${liveUrl}`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp · Link with score
          </a>
        ) : null}
      </div>
    </section>
  );
}
