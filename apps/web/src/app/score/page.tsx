import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandGlyph } from "@desiauction/ui";
import { currentSession } from "../../server/auth/actions";
import {
  scoringDay,
  scoringHomeForPerson,
  hasFinishedScoringForPerson,
} from "../../server/scoring/home";
import { ScoreInstall } from "./score-install";
import { HomeCards } from "./home-cards";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Score", robots: { index: false, follow: false } };
export default async function ScoreHome() {
  const session = await currentSession();
  if (!session) redirect("/login?next=%2Fscore");
  const today = scoringDay();
  const [rows, finished] = await Promise.all([
    scoringHomeForPerson(session.personId),
    hasFinishedScoringForPerson(session.personId),
  ]);
  const dayLabel = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${today}T00:00:00Z`));
  return (
    <main className="score-home">
      <header className="score-header">
        <span className="score-brand">
          <BrandGlyph size={28} />
          <span className="score-cap">Scorer</span>
        </span>
      </header>
      <div className="score-home-title">
        <p className="score-cap">{dayLabel}</p>
        <h1>
          {rows.length} {rows.length === 1 ? "match" : "matches"} to score
        </h1>
      </div>
      <HomeCards matches={rows} />
      {finished ? <ScoreInstall /> : null}
    </main>
  );
}
