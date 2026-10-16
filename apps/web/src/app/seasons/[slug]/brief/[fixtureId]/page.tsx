import { notFound } from "next/navigation";
import { ButtonLink, PlayerPortrait } from "@desiauction/ui";
import { styleLabel } from "@desiauction/core";
import { RecordedShots } from "../../../../../components/cricket-insights";
import { captainBrief } from "../../../../../server/insights/brief";
import "./brief.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Captain’s brief", robots: { index: false, follow: false } };
export default async function BriefPage({
  params,
}: {
  params: Promise<{ slug: string; fixtureId: string }>;
}) {
  const { slug, fixtureId } = await params;
  const brief = await captainBrief(slug, fixtureId);
  if (!brief) notFound();
  if (brief.locked)
    return (
      <main className="captain-brief">
        <ButtonLink
          href={`/seasons/${slug}/fixtures?match=${encodeURIComponent(fixtureId)}`}
          variant="ghost"
        >
          Back to this match
        </ButtonLink>
        <p>Captain’s brief · Pro</p>
        <h2>Know your opponent</h2>
        <p>Available on Pro seasons</p>
        <p>Prepare with verified batting and bowling insights before the match.</p>
      </main>
    );
  const recorded = brief.players.filter(
    (player) =>
      player.batting.sample.balls > 0 ||
      player.batting.average !== null ||
      player.bowling.sample.balls > 0,
  );
  return (
    <main className="captain-brief">
      <ButtonLink
        href={`/seasons/${slug}/fixtures?match=${encodeURIComponent(fixtureId)}`}
        variant="ghost"
      >
        Back to this match
      </ButtonLink>
      <p>Captain’s brief · {brief.fixtureNumber} · Pro</p>
      {brief.teams.map((team) => (
        <section key={team.id} aria-label={`Know ${team.name}`}>
          <h2>Know {team.name}</h2>
          {recorded
            .filter((player) => player.teamId === team.id)
            .map((player) => {
              const batting = player.batting.sample.balls > 0 || player.batting.average !== null;
              const sample = batting ? player.batting.sample : player.bowling.sample;
              const shots = batting ? player.batting.shots : player.bowling.shots;
              const death = player.bowling.phases.find(
                (phase) => phase.key === "death" && !phase.sample.small,
              );
              return (
                <article className="brief-player" key={player.id}>
                  <header>
                    <div className="brief-portrait">
                      <PlayerPortrait name={player.name} seed={player.id} decorative />
                    </div>
                    <h3>{player.name}</h3>
                  </header>
                  <p>
                    {sample.balls} {batting ? "batting" : "bowling"} balls in {sample.matches}{" "}
                    matches
                  </p>
                  <div className="brief-evidence" data-shots={shots.length > 0}>
                    {shots.length > 0 ? (
                      <div className="brief-shots">
                        <RecordedShots rows={shots} />
                      </div>
                    ) : null}
                    <div>
                      <p>
                        {batting ? "Strike rate" : "Economy"}{" "}
                        {(batting ? player.batting.strikeRate : player.bowling.economy)?.toFixed(
                          1,
                        ) ?? "—"}
                      </p>
                      {player.matchup ? (
                        <p>
                          Slowest against {styleLabel(player.matchup.style)}:{" "}
                          {player.matchup.rate.toFixed(1)} an over in{" "}
                          {player.matchup.sample.matches} matches.
                        </p>
                      ) : batting ? (
                        <p>Not enough recorded balls against a known bowling type for a matchup.</p>
                      ) : null}
                      {death?.economy !== null && death && (
                        <p>
                          Concedes {death.economy.toFixed(1)} an over at the death ·{" "}
                          {death.sample.balls} balls.
                        </p>
                      )}
                    </div>
                  </div>
                  {sample.small && <p>Small sample · {sample.remaining} more balls for 60.</p>}
                </article>
              );
            })}
          {recorded.every((player) => player.teamId !== team.id) && (
            <p>
              {brief.players.some((player) => player.teamId === team.id)
                ? "No verified completed-match data for the announced XI."
                : "No XI has been announced for this team."}
            </p>
          )}
        </section>
      ))}
      <p>
        Only verified and confirmed completed matches in this club count. The displayed fixture is
        excluded. No recommendation is ranked below a 60-ball sample.
      </p>
    </main>
  );
}
