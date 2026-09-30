/**
 * THE AUDIENCE PAGES (SEO-1 Phase 4b) — `/for` and `/for/[slug]`.
 *
 * The sport pages answer "does it know my sport?"; these answer "does it know
 * how MY kind of league runs?" — a company league on a weekday evening, a
 * housing society's premier league in the clubhouse, a college fest, a village
 * tournament on a maidan, a turf that runs leagues for money.
 *
 * SAME TWO RULES AS content/sports.ts:
 *   1. True of the product today. Checked in code before it was written:
 *      one-tap WhatsApp share links (not automated WhatsApp messages, which
 *      depend on provider credentials), entry-fee status per player, cash /
 *      UPI / bank collections and numbered receipts, points auctions, Google
 *      Form import, an appointed auctioneer, seasons that recur under one
 *      tournament, open / men / women / mixed categories, and no phone number
 *      on any public page.
 *   2. About THIS audience. A paragraph that would read the same on every
 *      page belongs in the template (content/sports.test.ts has the same
 *      no-repeated-paragraph rule as audiences.test.ts).
 */

export interface AudiencePoint {
  readonly title: string;
  readonly body: string;
}

export interface AudienceFaq {
  readonly question: string;
  readonly answer: string;
}

export interface AudiencePage {
  /** The URL segment: `/for/${slug}`. */
  readonly slug: string;
  /** The hub card's name for the audience. */
  readonly name: string;
  /** The <title> before the site suffix. */
  readonly title: string;
  readonly headline: string;
  /** Meta description: 50–160 characters. */
  readonly description: string;
  readonly lede: string;
  /** What this kind of league needs that the others do not. */
  readonly points: readonly [AudiencePoint, AudiencePoint, AudiencePoint];
  /** A season, start to finish, the way this audience runs one. */
  readonly steps: readonly string[];
  /** Sport pages (content/sports.ts slugs) this audience most often plays. */
  readonly sports: readonly string[];
  readonly faqs: readonly AudienceFaq[];
  readonly updatedOn: string;
}

export const AUDIENCE_PAGES: readonly AudiencePage[] = [
  {
    slug: "corporate-leagues",
    name: "Corporate leagues",
    title: "Corporate cricket league auction",
    headline: "Run your company's league like a franchise auction",
    description:
      "Run a corporate cricket or football league with a live player auction: employees register by role, team owners bid from their phones, the office watches.",
    lede: "An inter-department league is a team-building event first. Get every employee registered, turn auction night into the evening the whole office talks about, and run the season without a spreadsheet passed around on email.",
    points: [
      {
        title: "Mixed and women's leagues",
        body: "Set a season's category to open, men's, women's or mixed, and the public page says so in words — so everyone deciding whether to sign up knows what kind of league it is.",
      },
      {
        title: "Budgets in points, not salaries",
        body: "Most company leagues do not want real money on the table. A points auction gives every department the same budget in points, and the night plays exactly the same.",
      },
      {
        title: "The same league every year",
        body: "A season sits under a tournament that recurs, so next year's league keeps this year's name, history and records — and HR does not start from scratch.",
      },
    ],
    steps: [
      "Share the registration link on the company chat; employees sign up with their role.",
      "Name a team owner per department or floor, and give each team the same points budget.",
      "Run auction night in the cafeteria or on a video call, with the board on the big screen.",
      "Publish the fixtures and let the table update as each match is entered.",
    ],
    sports: ["cricket", "box-cricket", "football", "badminton"],
    faqs: [
      {
        question: "Can we run a corporate league auction without real money?",
        answer:
          "Yes. Run a points auction: every team gets the same budget in points, and nothing is owed or collected afterwards.",
      },
      {
        question: "Can someone other than the organizer run the auction?",
        answer:
          "Yes. Appoint an auctioneer for the night — they get the auction controls without owning the league.",
      },
      {
        question: "Can remote employees join auction night?",
        answer:
          "Yes. Owners bid from their own phones wherever they are, and anyone with the public link can watch the board live without signing in.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "housing-societies",
    name: "Housing societies",
    title: "Society premier league auction",
    headline: "Your society's premier league, with a proper auction night",
    description:
      "Run your housing society's premier league: residents register, flat-wing team owners bid live in the clubhouse, and entry fees are tracked per player.",
    lede: "The society premier league is the weekend everyone in the complex waits for. Collect registrations from every wing, run the auction in the clubhouse with the board on the TV, and keep track of who has paid the entry fee.",
    points: [
      {
        title: "Entry fees, tracked per player",
        body: "Mark each resident's entry fee as pending, paid or waived on the registration desk, so the committee knows who still owes before the auction — not after.",
      },
      {
        title: "Residents' numbers stay private",
        body: "The public tournament page shows teams, squads and fixtures, never a phone number. A league that everyone in the society can open is not a list of everyone's number.",
      },
      {
        title: "Captains and icon players first",
        body: "Wing captains and the society's star players can be placed in their teams before the auction and kept out of the auction pool, the way society leagues usually start.",
      },
    ],
    steps: [
      "Post the registration link on the society WhatsApp group; residents sign up by role.",
      "Track entry fees on the registration desk and approve players as they pay.",
      "Hold auction night in the clubhouse with the board on the TV and owners on their phones.",
      "Share the public page so the whole complex can follow the fixtures and the table.",
    ],
    sports: ["cricket", "box-cricket", "badminton", "football"],
    faqs: [
      {
        question: "How do residents register?",
        answer:
          "Share the registration link on the society group. Residents fill a short form on their phone — no app, no account password.",
      },
      {
        question: "Can the committee see who has paid the entry fee?",
        answer:
          "Yes. Each registration has a fee status — pending, paid or waived — that the organizers set on the registration desk.",
      },
      {
        question: "Will residents' phone numbers be public?",
        answer:
          "No. Public pages show names, teams and fixtures. Phone numbers are only visible to the organizers running the league.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "college-fests",
    name: "Colleges and fests",
    title: "College fest player auction",
    headline: "Run the auction at your college fest",
    description:
      "Run a player auction for your college fest or inter-hostel league: cricket, football, esports and BGMI, with the auction projected in the auditorium.",
    lede: "At a fest the auction is the event — a packed auditorium, a projector and a hundred phones. Register students by sport and role, let hostels or clubs bid for their squads, and stream the whole thing if you want.",
    points: [
      {
        title: "Esports and BGMI, not just cricket",
        body: "The same fest can run a cricket auction, a Valorant-style esports roster auction and a BGMI squad auction — each with its own roles and its own standings, including battle royale lobbies scored by placement and kills.",
      },
      {
        title: "Made for a projector and a stream",
        body: "The auction board goes on the auditorium screen, and the public spectator page can go on a stream. Anyone with the link watches live without signing in.",
      },
      {
        title: "Hand the gavel to the host",
        body: "Appoint the fest's host as auctioneer: they call the players and mark each sale from the auction controls, without being given the rest of the organizer's access.",
      },
    ],
    steps: [
      "Open registration per sport and share the link on the fest's social pages.",
      "Hostels, clubs or year groups become team owners with a budget each.",
      "Run the auction on stage, with the board projected and the spectator link streamed.",
      "Publish fixtures for the fest days and let the table and results follow.",
    ],
    sports: ["cricket", "football", "esports", "battle-royale", "basketball"],
    faqs: [
      {
        question: "Can we run a BGMI or esports auction at our fest?",
        answer:
          "Yes. Esports rosters are scored by maps and rounds, and battle royale squads play lobbies scored by placement plus kills.",
      },
      {
        question: "Can the auction be streamed?",
        answer:
          "Yes. The public spectator page shows the live board to anyone with the link, which is made to go on a stream.",
      },
      {
        question: "Can students register without making an account first?",
        answer:
          "They sign in with a one-time code to their email or phone when they register — there is no password to create.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "village-tournaments",
    name: "Village and district tournaments",
    title: "Village cricket tournament auction",
    headline: "Run your village or district tournament's auction",
    description:
      "Run the player auction for your village or district cricket, kabaddi or volleyball tournament: phone-first registration, cash collections and receipts.",
    lede: "A gaon or district tournament runs on phones, cash and a loudspeaker. Take registrations on WhatsApp, hold the auction on a maidan or in a hall, and record the money the way it actually changes hands.",
    points: [
      {
        title: "Cash is a first-class payment",
        body: "Record what each team pays as cash, UPI or bank transfer against what it owes, and issue receipts numbered in an unbroken series — so the committee can show every rupee.",
      },
      {
        title: "Kabaddi and volleyball, not just cricket",
        body: "Kabaddi squads register as raiders, defenders and all-rounders, and volleyball sides as setters, attackers, blockers and liberos — each with its own table.",
      },
      {
        title: "Works on the phones people have",
        body: "Everything runs in the phone's browser. Nobody installs an app, and a phone that drops off the network rejoins the auction exactly where the room is.",
      },
    ],
    steps: [
      "Share the registration link on WhatsApp; players register on their own phones.",
      "Set each team's purse and squad size, and the base price for players.",
      "Run the auction with the board on a TV or projector, or just on the owners' phones.",
      "Record each team's payments in cash or UPI and hand over numbered receipts.",
    ],
    sports: ["cricket", "kabaddi", "volleyball", "box-cricket"],
    faqs: [
      {
        question: "Can we record cash payments from teams?",
        answer:
          "Yes. Collections are recorded as cash, UPI or bank transfer against each team's dues, and every receipt is numbered in one unbroken series.",
      },
      {
        question: "Do we need a projector?",
        answer:
          "No. It helps for the crowd, but owners bid from their own phones and can follow the auction there.",
      },
      {
        question: "Can players register without a smartphone app?",
        answer:
          "Yes. The registration form opens in any phone browser from the link — there is nothing to install.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "turfs-and-academies",
    name: "Turfs and academies",
    title: "Turf league and academy auctions",
    headline: "Run auction leagues at your turf or academy",
    description:
      "Run box cricket, football and pickleball leagues at your turf or academy with a live player auction, entry fees per player, and a public table.",
    lede: "A turf or academy that runs leagues runs them again and again. Keep every season under one tournament, auction players into teams each time, and give your players a public page they will share.",
    points: [
      {
        title: "Season after season, one home",
        body: "Each league is a season under a tournament that recurs, so the spring league and the summer league sit together with their own squads, results and tables.",
      },
      {
        title: "Entry fees per player",
        body: "Mark each player's entry fee as paid, pending or waived on the registration desk before the auction, so the teams that go into the room are the teams that have paid.",
      },
      {
        title: "A page players share",
        body: "Every published season has a public page with teams, squads, fixtures and the table, and every player and team gets a share card made for WhatsApp.",
      },
    ],
    steps: [
      "Open a new season under your turf's tournament and share the registration link.",
      "Track entry fees and approve players into the pool.",
      "Run the auction on the turf's screen with owners bidding from their phones.",
      "Publish the fixtures for your boxes or courts and let the table follow.",
    ],
    sports: ["box-cricket", "football", "pickleball", "badminton"],
    faqs: [
      {
        question: "Can a turf run several leagues a year?",
        answer:
          "Yes. Each league is its own season under your tournament, with its own registrations, auction, fixtures and table.",
      },
      {
        question: "Can we charge players an entry fee?",
        answer:
          "Yes. Track each player's entry fee on the registration desk — pending, paid or waived.",
      },
      {
        question: "Is it free?",
        answer: "Yes, during the beta. Tournaments you start now stay free.",
      },
    ],
    updatedOn: "2026-09-30",
  },
];

export function audiencePage(slug: string): AudiencePage | undefined {
  return AUDIENCE_PAGES.find((page) => page.slug === slug);
}
