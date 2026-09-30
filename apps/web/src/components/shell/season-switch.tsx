"use client";

import { Drawer, IconChevronDown, PopoverMenu } from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * THE SEASON, AS A SWITCHER (header 9.5, 2026-09-30).
 *
 * The season a page belongs to is named once and is the way to another: on a
 * phone a chip pinned at the start of the tab row (the title row it used to
 * sit under is gone), on a laptop the last crumb of the trail. Both open the
 * same list — the viewer's seasons, their own club's first under the club's
 * name, which is where a phone keeps the club now that the trail is off screen.
 *
 * It replaced a "Switch ▾" button in the laptop's utility cluster, shown only
 * with two or more seasons, and nothing at all on a phone.
 */

/** What the switcher reads of a season (the shell's SwitchSeason fits). */
export interface SwitchSeason {
  slug: string;
  name: string;
  orgName: string;
  orgSlug: string;
}

interface Props {
  current: SwitchSeason;
  seasons: readonly SwitchSeason[];
}

/** The viewer's seasons, grouped by club, the current season's club first. */
function byClub(current: SwitchSeason, seasons: readonly SwitchSeason[]) {
  const clubs = new Map<string, { name: string; seasons: SwitchSeason[] }>();
  for (const season of [current, ...seasons.filter((entry) => entry.slug !== current.slug)]) {
    const club = clubs.get(season.orgSlug) ?? { name: season.orgName, seasons: [] };
    club.seasons.push(season);
    clubs.set(season.orgSlug, club);
  }
  return [...clubs.values()];
}

/** The phone's chip, pinned at the start of the season's tab row. */
export function SeasonChip({ current, seasons }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="shell-season-chip"
        aria-label={`Season: ${current.name}, ${current.orgName}. Change season`}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="season-chip"
      >
        <span className="shell-season-chip-pill">
          <span className="shell-season-chip-name">{current.name}</span>
          <IconChevronDown size={14} aria-hidden />
        </span>
      </button>
      {/* Mounted only while open, like the menu drawer: a closed <dialog> would
          leave its h2 in every season page's DOM. */}
      {open ? (
        <Drawer
          open
          side="bottom"
          title="Switch season"
          onClose={() => {
            setOpen(false);
          }}
          className="shell-season-sheet"
        >
          <div className="shell-season-sheet-body">
            {byClub(current, seasons).map((club) => (
              <section key={club.name} className="shell-season-club">
                <h3 className="shell-season-club-name">{club.name}</h3>
                <ul className="shell-season-list">
                  {club.seasons.map((season) => (
                    <li key={season.slug}>
                      <Link
                        href={`/seasons/${season.slug}`}
                        className="shell-season-row"
                        aria-current={season.slug === current.slug ? "page" : undefined}
                        onClick={() => {
                          setOpen(false);
                        }}
                      >
                        <span className="shell-season-row-name">{season.name}</span>
                        {season.slug === current.slug ? (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="m5 12.5 4.5 4.5L19 7.5" />
                          </svg>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <Link
              href="/tournaments"
              className="shell-season-all"
              onClick={() => {
                setOpen(false);
              }}
            >
              All tournaments
            </Link>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}

/**
 * The laptop's last crumb: the season's name, and the way to another. On the
 * season's overview its name is already the page's h1 (the hero), and the
 * trail never prints a name twice — there it reads "Switch season".
 */
export function SeasonCrumb({
  current,
  seasons,
  named = true,
}: Props & {
  /** False where the page's own heading already names the season. */
  named?: boolean;
}) {
  const router = useRouter();
  const others = byClub(current, seasons)
    .flatMap((club) => club.seasons)
    .filter((season) => season.slug !== current.slug);
  return (
    <PopoverMenu
      label={`Season: ${current.name}. Change season`}
      align="start"
      triggerClassName="shell-season-crumb"
      trigger={
        <>
          <span className="shell-season-crumb-name">{named ? current.name : "Switch season"}</span>
          <IconChevronDown size={14} aria-hidden />
        </>
      }
      items={[
        ...others.map((season) => ({
          key: season.slug,
          label: `${season.name} — ${season.orgName}`,
          onSelect: () => {
            router.push(`/seasons/${season.slug}`);
          },
        })),
        {
          key: "all",
          label: "All tournaments",
          onSelect: () => {
            router.push("/tournaments");
          },
        },
      ]}
    />
  );
}
