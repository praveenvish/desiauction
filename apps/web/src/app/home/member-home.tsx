import { IconCalendar, IconUsers, Pill, SectionCard } from "@desiauction/ui";
import Link from "next/link";

import { competitionsView } from "../../server/competition/actions";
import { monogram, statusLabel, statusTone } from "./home-parts";

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
    /*
     * A club with no seasons yet. This used to return null — and membership is
     * the ONLY thing this person has, so the whole page below the greeting
     * became blank. An empty state that explains is the least a home can do;
     * a blank screen makes somebody wonder whether the product is broken.
     */
    return (
      <SectionCard
        data-testid="home-member"
        icon={<IconCalendar />}
        tone="neutral"
        title="Nothing running yet"
      >
        <p className="home-card-note">
          You&apos;re a member of {clubCount === 1 ? "a club" : `${String(clubCount)} clubs`} that
          hasn&apos;t started a season. When one opens, it will show up here — and you&apos;ll get a
          message if they ask you to register.
        </p>
      </SectionCard>
    );
  }
  return (
    <SectionCard
      data-testid="home-member"
      icon={<IconUsers />}
      tone="blue"
      title={`Seasons in your ${clubCount === 1 ? "club" : "clubs"}`}
    >
      <ul className="home-list">
        {view.competitions.map((competition) => (
          <li key={competition.id}>
            <Link href={`/seasons/${competition.slug}`} className="home-row-link">
              <span className="home-crest" aria-hidden>
                {monogram(competition.name)}
              </span>
              <span className="home-row-text">
                <strong>{competition.name}</strong>
                <span>{competition.orgName}</span>
              </span>
              <Pill tone={statusTone(competition.status)}>{statusLabel(competition.status)}</Pill>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
