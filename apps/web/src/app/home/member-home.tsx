import { Badge } from "@desiauction/ui";
import Link from "next/link";

import { competitionsView } from "../../server/competition/actions";
import { statusLabel, statusTone } from "./home-parts";

/**
 * FOR SOMEBODY WHOSE ONLY TIE IS MEMBERSHIP.
 *
 * Belonging to a club is not a role — it confers read access and never a menu
 * item (see the rule at the top of components/shell/nav.ts) — so this is the
 * one place in the product that membership renders, and it is the smallest
 * possible thing: the club's seasons, as plain doors.
 *
 * It used to render for EVERY non-organizer, headed "Seasons in your club". So
 * a team owner opening their home was shown the host club's whole calendar,
 * which is the membership-as-role leak in page form: `acceptOwnerJoin` makes
 * every accepted owner a viewer-level member. The router now renders this only
 * when membership is genuinely all somebody has.
 *
 * No settlement badge: that read belongs to the organizer's dashboard, and a
 * member holds no capability over these books. Plain lifecycle status only.
 */
export async function MemberHome({ clubCount }: { clubCount: number }) {
  const view = await competitionsView();
  if (view.competitions.length === 0) {
    return null;
  }
  return (
    <section className="home-member" aria-labelledby="home-member-title" data-testid="home-member">
      <header className="home-flat-head">
        <h2 id="home-member-title" className="home-flat-title">
          Seasons in your {clubCount === 1 ? "club" : "clubs"}
        </h2>
      </header>
      <ul className="home-rows">
        {view.competitions.map((competition) => (
          <li key={competition.id}>
            <Link href={`/seasons/${competition.slug}`} className="home-row">
              <span className="home-row-main">
                <strong>{competition.name}</strong>
                <span>{competition.orgName}</span>
              </span>
              <Badge tone={statusTone(competition.status)}>{statusLabel(competition.status)}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
