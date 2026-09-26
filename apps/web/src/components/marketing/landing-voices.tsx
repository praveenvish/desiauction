import { StarGlyphs } from "@desiauction/ui";
import { unstable_rethrow } from "next/navigation";

import { landingVoices, type LandingVoice } from "../../server/reviews/voices";
import styles from "./landing-voices.module.css";
import { formatMonthYear } from "../../lib/format-date";

/**
 * "In their own words" (FR-1 Phase 5). Not "from organizers" or "from people
 * who ran it": a platform review may come from a team owner, and the heading
 * must be true of every quote under it.
 *
 * The landing page's second database read, guarded exactly like the first
 * (<LiveTournaments/>): `unstable_rethrow` so Next's control flow passes, a log
 * so an outage is visible, and NOTHING rendered on failure — `GET /` must be a
 * 200 with Postgres stopped. Renders nothing, too, until there is a quote to
 * show: a heading over an empty space would be the page claiming voices it
 * does not have.
 *
 * Every word in a card is the reviewer's own, as they wrote it, under the name
 * they chose. The footnote says how the quotes got here, because a visitor who
 * has read this page's candor about having no customers deserves to know these
 * are not the thing it promised never to do.
 */
async function voices(): Promise<readonly LandingVoice[]> {
  try {
    return await landingVoices();
  } catch (error) {
    unstable_rethrow(error);
    // The same deliberate exception LiveTournaments makes: the visitor sees
    // nothing, so stderr is the only place the failure can surface.
    // eslint-disable-next-line no-console
    console.error("[landing] review quotes unavailable; hiding the section", error);
    return [];
  }
}

function month(date: Date): string {
  return formatMonthYear(date);
}

export async function LandingVoices() {
  const shown = await voices();
  if (shown.length === 0) {
    return null;
  }
  return (
    <section className="mk-band" aria-labelledby="voices-heading" data-testid="landing-voices">
      <div className="mk-container">
        <h2 id="voices-heading" className={`mk-h2 ${styles["heading"] ?? ""}`}>
          In their own words
        </h2>
        <ul className={styles["grid"]}>
          {shown.map((voice) => (
            <li key={voice.id} className={styles["card"]}>
              <p className={styles["rating"]}>
                <span className={styles["srOnly"]}>{`Rated ${String(voice.rating)} out of 5`}</span>
                <StarGlyphs rating={voice.rating} />
              </p>
              <blockquote className={styles["quote"]}>
                <p>{voice.quote}</p>
              </blockquote>
              <p className={styles["byline"]}>
                <span className={styles["name"]}>{voice.name}</span>
                {voice.org === null ? null : <span>{voice.org}</span>}
                <span className={styles["when"]}>{month(voice.publishedAt)}</span>
              </p>
            </li>
          ))}
        </ul>
        <p className={styles["footnote"]}>
          Every quote here is from someone we asked after they used DesiAuction, shown under the
          name they chose, with their permission, and not edited by us — a “…” marks where a long
          one was shortened.
        </p>
      </div>
    </section>
  );
}
