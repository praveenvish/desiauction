"use client";

import { IconGavel, IconHelp, IconLedger, IconReceipt, IconTrophy, IconUsers } from "@desiauction/ui";

import {
  CountChips,
  HeroFact,
  PageHero,
  PageSection,
  SportWatermark,
  StatStrip,
  TopicCard,
  TopicGrid,
} from "../../components/public/public-kit";
import { TeamCard, TeamGrid } from "../../components/public/team-card";
import { TournamentCard, TournamentGrid } from "../../components/public/tournament-card";

/**
 * THE PUBLIC KIT, on one page.
 *
 * Every part the public pages are assembled from, in both themes (flip the
 * gallery's theme switch). This is where a change to the kit is looked at
 * before it is spread across nine pages — and where the sport art can be
 * checked for all twelve packs at once.
 *
 * The data below is illustrative and says so: fictional clubs, no real person.
 */

const SPORTS = [
  "cricket",
  "box_cricket",
  "football",
  "basketball",
  "hockey",
  "kabaddi",
  "volleyball",
  "badminton",
  "table_tennis",
  "pickleball",
  "esports",
  "battle_royale",
];

export function PublicKitDemo() {
  return (
    <div className="gallery-stack">
      <h2>Public kit</h2>
      <p className="gallery-note">
        Fictional clubs and players — the kit is drawn with example data, never a real season.
      </p>

      <h3>Page hero</h3>
      <PageHero
        eyebrow="Find a tournament"
        title={
          <>
            Monsoon <em>Cup</em>
          </>
        }
        lede="Every tournament on DesiAuction that's open to the public."
        status={<span className="pk-chip" data-tone="open">Registration open</span>}
        meta={
          <>
            <HeroFact icon={<IconTrophy width={16} height={16} />}>Example Club</HeroFact>
            <HeroFact icon={<IconUsers width={16} height={16} />}>8 teams</HeroFact>
          </>
        }
        actions={
          <>
            <a className="tc-action" data-primary="" href="#kit-stats">
              Register as a player
            </a>
            <a className="tc-action" href="#kit-stats">
              All tournaments
            </a>
          </>
        }
        sport="cricket"
        script={
          <>
            Play
            <br />
            Bid
            <br />
            Belong
          </>
        }
      />

      <h3 id="kit-stats">Stat strip</h3>
      <StatStrip
        label="Example season at a glance"
        stats={[
          { value: "4", label: "Teams", icon: <IconUsers width={18} height={18} /> },
          { value: "16", label: "Approved players", icon: <IconUsers width={18} height={18} /> },
          { value: "₹1,00,000", label: "Purse per team", icon: <IconTrophy width={18} height={18} /> },
          { value: "4", label: "Squad size", icon: <IconGavel width={18} height={18} /> },
          { value: "Example Club", label: "Organized by", aside: true },
        ]}
      />

      <h3>Filter chips</h3>
      <CountChips
        label="Example filters"
        chips={[
          { label: "All", href: "#kit-stats", count: 10, active: true },
          { label: "Registration open", href: "#kit-stats", count: 3, tone: "open" },
          { label: "Live now", href: "#kit-stats", count: 1, tone: "live" },
          { label: "Upcoming", href: "#kit-stats", count: 2, tone: "soon" },
          { label: "Registration closed", href: "#kit-stats", count: 4, tone: "closed" },
        ]}
      />

      <h3>Tournament cards</h3>
      <TournamentGrid>
        <TournamentCard
          tournament={{
            name: "Example Monsoon Cup",
            slug: "gallery-example",
            orgName: "Example Club",
            sport: "cricket",
            location: "Malad, Mumbai",
            dates: "1 Aug – 15 Sep 2026",
            open: true,
            live: false,
            teamCount: 16,
            playerCount: 128,
          }}
        />
        <TournamentCard
          tournament={{
            name: "Example Night League",
            slug: "gallery-example-2",
            orgName: "Example Sports Group",
            sport: "football",
            location: "Kolkata",
            dates: "19 Sep – 21 Sep 2026",
            open: false,
            live: true,
            teamCount: 8,
            playerCount: 64,
            entryCategory: "women",
          }}
        />
        <TournamentCard
          tournament={{
            name: "Example Winter Kabaddi",
            slug: "gallery-example-3",
            orgName: "Example Association",
            sport: "kabaddi",
            location: null,
            dates: "Dates to be announced",
            open: false,
            live: false,
            teamCount: 6,
          }}
        />
      </TournamentGrid>

      <h3>Team cards</h3>
      <TeamGrid>
        <TeamCard
          href="#kit-stats"
          team={{
            id: "a",
            name: "Example A Team",
            color: "#1F7A4D",
            coachName: "Example Coach",
            players: [
              { name: "Player One", number: "R4QD52B", preSigned: true },
              { name: "Player Two", number: "R67X349" },
              { name: "Player Three", number: "RDH8Q8A" },
              { name: "Player Four", number: "RP4ZHK7" },
              { name: "Player Five", number: "RMV8PV5" },
            ],
          }}
        />
        <TeamCard
          href="#kit-stats"
          team={{
            id: "b",
            name: "Example B Team",
            color: "#2B4FA8",
            players: [
              { name: "Player Six", number: "R3H4ANE" },
              { name: "Player Seven", number: "R6RHCBS" },
            ],
          }}
        />
        <TeamCard team={{ id: "c", name: "Example C Team", color: "#8A2E2E", players: [] }} />
      </TeamGrid>

      <h3>Topic cards</h3>
      <TopicGrid>
        <TopicCard
          href="#kit-stats"
          icon={<IconHelp width={20} height={20} />}
          title="A tour of DesiAuction"
          description="What the platform does, how it's organized, and where to go next."
          foot="4 min read"
        />
        <TopicCard
          href="#kit-stats"
          tone="blue"
          icon={<IconGavel width={20} height={20} />}
          title="Conducting the auction"
          description="Run the room with confidence, including when something goes wrong."
          foot="7 min read"
        />
        <TopicCard
          href="#kit-stats"
          tone="green"
          icon={<IconLedger width={20} height={20} />}
          title="Money after the gavel"
          description="The settlement desk — recording money in, adjusting, and closing."
          foot="6 min read"
        />
        <TopicCard
          href="#kit-stats"
          tone="purple"
          icon={<IconReceipt width={20} height={20} />}
          title="Receipts and your register"
          description="Issue receipts, keep a sealed record, and check it still reproduces."
          foot="4 min read"
        />
      </TopicGrid>

      <h3>Sport art — every pack</h3>
      <PageSection headingId="kit-sport-art" title="Fallback art" lede="Drawn when no photograph exists for the sport, and for every season without a cover.">
        <div className="gallery-sport-grid">
          {SPORTS.map((sport) => (
            <figure className="gallery-sport" key={sport}>
              <SportWatermark sport={sport} />
              <figcaption>{sport.replace("_", " ")}</figcaption>
            </figure>
          ))}
        </div>
      </PageSection>
    </div>
  );
}
