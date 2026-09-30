/**
 * THE SPORT PAGES (SEO-1 Phase 4) — `/sports` and `/sports/[slug]`.
 *
 * WHAT IS WRITTEN HERE, AND WHAT IS NOT. Each entry holds only the words a
 * person has to write: the headline, what makes an auction in this sport
 * different, and the questions an organizer in this sport actually asks. The
 * FACTS — the roles a registration form offers, the player attributes, how the
 * table awards points and breaks ties — are read from the sport pack in
 * `@desiauction/core` at render time, so a page can never contradict the
 * engine that runs the season.
 *
 * TWO RULES FOR EVERY SENTENCE:
 *   1. It must be true of the product today. Nothing here promises a feature
 *      that is not built (no RTM, no player bidding, no native app).
 *   2. It must be about THIS sport. A paragraph that would read the same on
 *      every page belongs on the shared part of the template, not here —
 *      near-identical pages are what search engines demote a whole site for.
 *
 * `updatedOn` is the sitemap's lastmod: bump it only when the words change.
 */

export interface SportPageAngle {
  readonly title: string;
  readonly body: string;
}

export interface SportPageFaq {
  readonly question: string;
  readonly answer: string;
}

export interface SportPage {
  /** The URL segment: `/sports/${slug}`. */
  readonly slug: string;
  /** The sport pack's key in `@desiauction/core` (SPORTS). */
  readonly sport: string;
  /** The <title> before the site suffix. Unique; short enough to show whole. */
  readonly title: string;
  /** The page's <h1>. */
  readonly headline: string;
  /** Meta description: 50–160 characters (the SEO suite enforces it). */
  readonly description: string;
  /** The hero's first paragraph. */
  readonly lede: string;
  /** Three things that make an auction in this sport its own job. */
  readonly angles: readonly [SportPageAngle, SportPageAngle, SportPageAngle];
  readonly faqs: readonly SportPageFaq[];
  readonly updatedOn: string;
}

export const SPORT_PAGES: readonly SportPage[] = [
  {
    slug: "cricket",
    sport: "cricket",
    title: "Cricket player auction app",
    headline: "Run your cricket player auction, IPL-style",
    description:
      "Run an IPL-style player auction for your cricket league: owners bid from their phones, the room watches the big screen, and the points table keeps itself.",
    lede: "Registration by batting and bowling style, a live auction night your owners bid in from their own phones, and a season whose points table and net run rate update as results come in.",
    angles: [
      {
        title: "Balanced squads, not just big buys",
        body: "Every player's role — batter, bowler, all-rounder, keeper — is on their auction card, and each team's remaining purse is on screen, so owners can plan the last picks instead of guessing. The reserve rule refuses a bid that would leave a team unable to complete its minimum squad.",
      },
      {
        title: "Batting and bowling style on every card",
        body: "The registration form asks for batting style and bowling style from a fixed list, so an owner bidding on a left-arm orthodox spinner sees exactly that on the big screen, not whatever a player typed into a Google Form.",
      },
      {
        title: "Net run rate, worked out for you",
        body: "Enter runs, wickets and overs (18.3, not 18.5) after each match. The table awards 2 for a win and 1 for a tie or no result, and separates teams on points by net run rate.",
      },
    ],
    faqs: [
      {
        question: "Can I run an IPL-style auction for a local cricket tournament?",
        answer:
          "Yes. Set a purse per team, a squad size and base prices, then run the auction live: the auctioneer calls each player, owners bid from their phones, and every screen in the room shows the same bid at the same moment.",
      },
      {
        question: "Can captains and icon players skip the auction?",
        answer:
          "Yes. Mark a player as captain or icon on the registration desk and they are placed in their team before the auction, and kept out of the auction pool.",
      },
      {
        question: "Our players registered through a Google Form. Do they have to register again?",
        answer:
          "No. Import the form's responses: the columns are matched to name, phone, role and batting and bowling style, and each row is checked before anything is saved.",
      },
      {
        question: "Can we auction in points instead of rupees?",
        answer:
          "Yes. A points auction gives each team a budget in points, so the night works the same way without any money changing hands.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "box-cricket",
    sport: "box_cricket",
    title: "Box cricket league auction",
    headline: "Auction players for your box cricket league",
    description:
      "Run a player auction for your box cricket or turf league: short-format scoring, net run rate on the table, and owners bidding live from their phones.",
    lede: "Box cricket leagues move fast — short overs, small squads, several matches a night. Register players, auction them in an evening, and let the table keep up with the turf.",
    angles: [
      {
        title: "Made for the short format",
        body: "Scores are entered as runs, wickets and overs (6.3, not 6.5), the way a box match is actually kept, and a scoreline reads 54/3 (6.0) on the table and the public page.",
      },
      {
        title: "Small squads, every pick counts",
        body: "With six or eight players a side, one bad buy shows. Each team's remaining purse is on screen, and the reserve rule stops a bid that would leave a team short of its minimum squad.",
      },
      {
        title: "Built for a night at the turf",
        body: "Put the auction board on a TV at the turf and let owners bid from their phones. Anyone with the link can follow from outside without signing in.",
      },
    ],
    faqs: [
      {
        question: "Does the points table handle box cricket scoring?",
        answer:
          "Yes. A win is 2 points and a tie or no result 1, and teams level on points are separated by net run rate, worked out from the runs and overs you enter.",
      },
      {
        question: "How many teams and players can a box cricket league have?",
        answer:
          "You set both. The purse per team and the squad size are the auction's rules, and the auction will not let a team finish above its maximum or be left unable to reach its minimum.",
      },
      {
        question: "Can we run the auction without money?",
        answer:
          "Yes. Run a points auction and each team gets a budget in points instead of rupees.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "football",
    sport: "football",
    title: "Football player auction app",
    headline: "Run a football player auction for your league",
    description:
      "Auction players for your football or 5-a-side league: positions and preferred foot on every card, live bidding from phones, goal difference on the table.",
    lede: "From 5-a-side on a Sunday to a full-pitch club league: players register by position and preferred foot, owners build a side on auction night, and the table follows every result.",
    angles: [
      {
        title: "Positions, not just names",
        body: "Players register as goalkeeper, defender, midfielder or forward, and the position is on their auction card, so no owner has to ask who plays where while the bidding runs.",
      },
      {
        title: "Preferred foot on the card",
        body: "The form asks each player's preferred foot — right, left or both — and it shows on the auction screen next to their position.",
      },
      {
        title: "A league table that knows football",
        body: "A win is 3 points and a draw 1. Teams level on points are separated by goal difference, then goals scored, the way a football table is read.",
      },
    ],
    faqs: [
      {
        question: "Can I use it for a 5-a-side or 7-a-side league?",
        answer:
          "Yes. You set the squad size for the auction and the number of teams, so a small-sided league works the same way as a full-pitch one.",
      },
      {
        question: "How is the table sorted?",
        answer: "By points (3 for a win, 1 for a draw), then goal difference, then goals scored.",
      },
      {
        question: "Can captains be placed in teams before the auction?",
        answer:
          "Yes. Mark a player as captain on the registration desk and they join their team before the auction and stay out of the auction pool.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "kabaddi",
    sport: "kabaddi",
    title: "Kabaddi player auction app",
    headline: "Run a kabaddi auction, raiders to defenders",
    description:
      "Run a pro-kabaddi-style player auction for your league: raiders, defenders and all-rounders, live bidding from phones, and score difference on the table.",
    lede: "Build squads the way the pro leagues do — raiders, defenders and all-rounders — in one auction night, then run the season with a table that follows every match on the mat.",
    angles: [
      {
        title: "Raiders, defenders, all-rounders",
        body: "Players register in the role they play, and it is on their auction card, so owners bidding for a squad know exactly whether they are buying a raider or a corner.",
      },
      {
        title: "One room, every phone in it",
        body: "Owners bid from their own phones while the auction board runs on the big screen, and every screen shows the same bid at the same moment. A dropped phone rejoins where the room is.",
      },
      {
        title: "A table that reads like kabaddi",
        body: "A win is 2 points and a tie 1. Teams level on points are separated by score difference, then points scored.",
      },
    ],
    faqs: [
      {
        question: "Can I run a pro-kabaddi-style auction for a local league?",
        answer:
          "Yes. Give each team a purse and a squad size, set base prices, and run the auction live with owners bidding from their phones.",
      },
      {
        question: "How are kabaddi results entered?",
        answer:
          "Enter each team's points after the match. The table awards 2 for a win and 1 for a tie, and separates teams by score difference, then points scored.",
      },
      {
        question: "Can spectators follow the auction?",
        answer:
          "Yes. Share the auction's public link and anyone can watch the board live, without signing in.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "volleyball",
    sport: "volleyball",
    title: "Volleyball league auction",
    headline: "Auction players for your volleyball league",
    description:
      "Run a player auction for your volleyball league: setters, attackers, blockers and liberos, live bidding from phones, and a table sorted by set ratio.",
    lede: "A volleyball side lives or dies on balance — a setter, hitters, a libero. Register players by position, auction them in one evening, and let the table follow every set.",
    angles: [
      {
        title: "Every position on the court",
        body: "Players register as setter, attacker, blocker or libero, and the position is on their auction card, so owners can build a balanced six rather than four attackers.",
      },
      {
        title: "Spiking hand, recorded",
        body: "The form asks whether a player spikes right- or left-handed, and it shows on their auction card.",
      },
      {
        title: "Sets, then points",
        body: "Enter sets and points after each match. A win is 3 points and a tie 1, and teams level on points are separated by set ratio, then point ratio.",
      },
    ],
    faqs: [
      {
        question: "How does the volleyball table break ties?",
        answer: "By set ratio first, then point ratio, worked out from the results you enter.",
      },
      {
        question: "Can we auction in points instead of rupees?",
        answer: "Yes. A points auction gives each team a budget in points rather than money.",
      },
      {
        question: "Do owners need to install anything?",
        answer:
          "No. Owners bid from the browser on their own phones, and the auction board runs on any screen with a browser.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "hockey",
    sport: "hockey",
    title: "Hockey player auction app",
    headline: "Run a hockey player auction for your league",
    description:
      "Auction players for your hockey league: goalkeepers to forwards on every card, owners bidding live from phones, and goal difference on the league table.",
    lede: "Register players by position, auction them on one night with every owner bidding from their own phone, and run the season with a table that follows every result.",
    angles: [
      {
        title: "Goalkeepers to forwards",
        body: "Players register as goalkeeper, defender, midfielder or forward, and the position is on their auction card, so goalkeepers are bought as goalkeepers, not as an afterthought at the end of the night.",
      },
      {
        title: "The same bid on every screen",
        body: "Bids are checked by the server and reach the auction board and every owner's phone at once, so there is no argument about who bid first.",
      },
      {
        title: "Goal difference, done for you",
        body: "A win is 3 points and a draw 1. Teams level on points are separated by goal difference, then goals scored.",
      },
    ],
    faqs: [
      {
        question: "How is the hockey table sorted?",
        answer:
          "Points come first — 3 for a win, 1 for a draw. Sides level on points are split by goal difference, and then by goals scored.",
      },
      {
        question: "Can captains skip the auction?",
        answer:
          "Yes. Mark a player as captain on the registration desk and they are placed in their team before the auction begins.",
      },
      {
        question: "Can spectators watch without an account?",
        answer:
          "Yes. The auction has a public page anyone with the link can watch live, without signing in.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "basketball",
    sport: "basketball",
    title: "Basketball league auction",
    headline: "Auction players for your basketball league",
    description:
      "Run a player auction for your basketball league: guards, forwards and centres, live bidding from phones, and a table that scores a loss the FIBA way.",
    lede: "Guards, forwards, centres — register players by position, build five-a-side rosters on auction night, and run a season whose table scores games the way basketball does.",
    angles: [
      {
        title: "Guards, forwards, centres",
        body: "Players register by position and it shows on their auction card, so an owner knows whether the next lot is the centre they still need.",
      },
      {
        title: "A loss still scores",
        body: "The table uses the FIBA scheme: 2 points for a win and 1 for a loss, so a team that turns up and loses still moves. Teams level on points are separated by point difference, then points scored.",
      },
      {
        title: "Built for a small roster",
        body: "With five on court, every pick shows. The reserve rule refuses any bid that would leave a team unable to complete its minimum squad.",
      },
    ],
    faqs: [
      {
        question: "Why does a loss score a point?",
        answer:
          "That is how FIBA tables work: 2 for a win, 1 for a loss. It rewards teams that play all their games.",
      },
      {
        question: "How are ties on points broken?",
        answer: "By point difference, then points scored.",
      },
      {
        question: "Can owners bid from their phones?",
        answer:
          "Yes. Each owner bids from their own phone in the browser, while the auction board runs on the big screen.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "esports",
    sport: "esports",
    title: "Esports player auction",
    headline: "Run an esports player auction for your tournament",
    description:
      "Auction players into rosters for your esports tournament: in-game leaders to snipers, live bidding, and standings by map and round difference.",
    lede: "Build rosters the way franchise leagues do: players register by role, team owners bid live for their line-up, and the standings follow every map.",
    angles: [
      {
        title: "Roles a roster actually needs",
        body: "Players register as in-game leader, entry fragger, anchor or sniper, and the role is on their auction card, so a roster gets an IGL on purpose, not by accident.",
      },
      {
        title: "Maps and rounds, not goals",
        body: "Enter maps and rounds after each match. A win is 3 points and a tie 1, and teams level on points are separated by map difference, then round difference.",
      },
      {
        title: "Stream-ready",
        body: "The auction board and the public spectator page are made to go on a stream, and anyone with the link can watch without signing in.",
      },
    ],
    faqs: [
      {
        question: "Is this for team titles like Valorant or CS?",
        answer:
          "Yes — for match formats where two rosters play maps and rounds. For battle royale lobbies there is a separate format.",
      },
      {
        question: "How are the standings sorted?",
        answer: "By points (3 for a win, 1 for a tie), then map difference, then round difference.",
      },
      {
        question: "Can we auction in points rather than money?",
        answer: "Yes. A points auction gives each team a budget in points.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "badminton",
    sport: "badminton",
    title: "Badminton league auction",
    headline: "Auction players for your badminton team league",
    description:
      "Run a player auction for a badminton team league: singles and doubles specialists, live bidding from phones, and ties scored by rubbers and games.",
    lede: "Team badminton leagues play ties, not single matches. Register players as singles or doubles specialists, build teams on auction night, and score each tie by rubbers.",
    angles: [
      {
        title: "Singles, doubles, all-court",
        body: "Players register as singles, doubles or all-court, and it shows on their auction card, so owners can build a team that covers every rubber in a tie.",
      },
      {
        title: "Ties, rubbers and games",
        body: "A fixture is a tie made of rubbers. Enter rubbers and games won, and the table awards 2 for a won tie and 1 for a drawn one, then separates teams by rubber difference, then game difference.",
      },
      {
        title: "Playing hand on the card",
        body: "The form asks whether a player is right- or left-handed, and it shows on their auction card.",
      },
    ],
    faqs: [
      {
        question: "Does it support team-format badminton leagues?",
        answer:
          "Yes. Each fixture is a tie between two teams, scored in rubbers and games, the way team leagues are played.",
      },
      {
        question: "How are teams separated on the table?",
        answer:
          "By points (2 for a won tie, 1 for a drawn one), then rubber difference, then game difference.",
      },
      {
        question: "Can captains be placed before the auction?",
        answer:
          "Yes. Mark a player as captain and they join their team before the auction, outside the auction pool.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "table-tennis",
    sport: "table_tennis",
    title: "Table tennis league auction",
    headline: "Auction players for your table tennis team league",
    description:
      "Run a player auction for a table tennis team league: attackers and defenders, grip on every card, and ties scored by rubbers and games on the table.",
    lede: "Team table tennis is played in ties of several rubbers. Register players by style and grip, build teams in one auction night, and let the table follow every tie.",
    angles: [
      {
        title: "Attackers, defenders, all-round",
        body: "Players register by playing style, so an owner can balance a team that attacks with one that can defend.",
      },
      {
        title: "Shakehand or penhold",
        body: "The form asks each player's grip, and it shows on their auction card.",
      },
      {
        title: "Scored by the tie",
        body: "Enter rubbers and games won. A won tie is 2 points and a drawn one 1, and teams level on points are separated by rubber difference, then game difference.",
      },
    ],
    faqs: [
      {
        question: "Does it work for team-format table tennis?",
        answer: "Yes. Each fixture is a tie between two teams, scored in rubbers and games.",
      },
      {
        question: "How is the table sorted?",
        answer:
          "Won ties are worth 2 points and drawn ties 1. Teams level on points are ranked by rubber difference first, then by game difference.",
      },
      {
        question: "Do players need an app?",
        answer: "No. Everything runs in the browser, on phones and on the big screen.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "pickleball",
    sport: "pickleball",
    title: "Pickleball league auction",
    headline: "Auction players for your pickleball team league",
    description:
      "Run a player auction for a pickleball team league: singles and doubles players, live bidding from phones, and ties scored by rubbers and games.",
    lede: "Pickleball team leagues are growing fast. Register players as singles or doubles specialists, auction them into teams on one night, and score each tie by rubbers.",
    angles: [
      {
        title: "Singles, doubles, all-court",
        body: "Players register by the format they play best, so owners can build a team that covers every rubber in a tie.",
      },
      {
        title: "Ties, rubbers and games",
        body: "Enter rubbers and games won after each tie. A win is 2 points and a draw 1, then teams are separated by rubber difference and game difference.",
      },
      {
        title: "A night everyone can watch",
        body: "The auction board goes on the big screen, owners bid from their phones, and anyone with the link can follow along without signing in.",
      },
    ],
    faqs: [
      {
        question: "Does it support team pickleball leagues?",
        answer: "Yes. Fixtures are ties between two teams, scored in rubbers and games.",
      },
      {
        question: "Our ties are mostly doubles. Can owners buy for that?",
        answer:
          "Yes. Players register as singles, doubles or all-court, and it is on their auction card, so owners can buy the doubles pairs their ties need rather than guessing.",
      },
      {
        question: "Can we run the auction in points instead of money?",
        answer:
          "Yes. In a points auction every team spends from a budget in points, so nothing is owed or collected once the night is over.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "battle-royale",
    sport: "battle_royale",
    title: "BGMI and battle royale auction",
    headline: "Run a battle royale squad auction",
    description:
      "Auction players into squads for your BGMI or battle royale tournament: lobby matches, placement points plus kills, and standings that update per lobby.",
    lede: "Battle royale is not a two-team sport, and the standings should not pretend it is. Auction players into squads, then score every lobby by where each squad finished and how many kills it took.",
    angles: [
      {
        title: "Lobbies, not head-to-heads",
        body: "Each match is a lobby with many squads in it. You record where each squad placed and its kills; nobody has to invent a home and an away.",
      },
      {
        title: "Placement points plus kills",
        body: "First place earns 10, second 6, third 5, then 4, 3, 2, 1 and 1 down to eighth, plus a point for every kill. Squads level on points are separated by kills.",
      },
      {
        title: "Squad roles",
        body: "Players register as in-game leader, assaulter, supporter or sniper, and the role is on their auction card, so every squad is built with a plan.",
      },
    ],
    faqs: [
      {
        question: "Does it work for BGMI or Free Fire tournaments?",
        answer:
          "Yes — for any battle royale format where squads play lobbies and are ranked by placement and kills.",
      },
      {
        question: "How are points awarded in a lobby?",
        answer:
          "By placement (10 for first, 6 for second, then 5, 4, 3, 2, 1, 1 down to eighth) plus one point per kill.",
      },
      {
        question: "Can the auction be streamed?",
        answer:
          "Yes. The auction board and the public spectator page are made to go on a stream, and viewers do not need an account.",
      },
    ],
    updatedOn: "2026-09-30",
  },
];

export function sportPage(slug: string): SportPage | undefined {
  return SPORT_PAGES.find((page) => page.slug === slug);
}

/**
 * The words for a tiebreaker's stored key (`TiebreakerSpec.key` in core). The
 * packs label ties "NRR", "GD", "RD" — right on a table header, cryptic in a
 * sentence. A test holds every pack's tiebreakers to having words here.
 */
export const TIEBREAKER_WORDS: Readonly<Record<string, string>> = {
  net_run_rate: "net run rate",
  goal_difference: "goal difference",
  goals_difference: "goal difference",
  goals_for: "goals scored",
  score_difference: "score difference",
  points_for: "points scored",
  set_ratio: "set ratio",
  point_ratio: "point ratio",
  point_difference: "point difference",
  map_difference: "map difference",
  round_difference: "round difference",
  rubbers_difference: "rubber difference",
  games_difference: "game difference",
  kills_for: "kills",
};
