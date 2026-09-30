import type { Block } from "./blocks";

/**
 * THE GUIDES (SEO-1 Phase 6) — `/guides` and `/guides/[slug]`.
 *
 * Help articles (content/help.ts) explain the PRODUCT: where a button is, what
 * a screen does. Guides answer the ORGANIZER'S question — how much purse, what
 * rules, how to run the night — and use the product as one way to do it. A
 * guide that only restated a help article would be a duplicate page.
 *
 * Every product statement here was checked against the code or the help
 * centre before it was written: the auction configuration is set once, at
 * creation, and locked; owner links are sent by the organizer (the platform
 * sends nothing); a paddle is granted separately; the reserve rule; icons,
 * captains and retained players are placed before the auction and kept out of
 * the pool; an unsold player passes for now and can come back in a later
 * round; undo needs an owner-level grant; the board and the overlay are public
 * on a published season; fee status per player; cash/UPI/bank collections and
 * numbered receipts; points auctions; no automated WhatsApp messages.
 *
 * Written by the DesiAuction team, and bylined that way: a guide is not
 * attributed to a person who did not write it.
 */
export interface Guide {
  readonly slug: string;
  readonly title: string;
  /** Meta description and card summary: 50–160 characters. */
  readonly summary: string;
  readonly publishedOn: string;
  /** When the words last changed (the sitemap's lastmod). */
  readonly updatedOn: string;
  readonly readMinutes: number;
  readonly blocks: readonly Block[];
}

const TEAM = "2026-10-01";

export const GUIDES: readonly Guide[] = [
  {
    slug: "how-to-run-a-cricket-player-auction",
    title: "How to run an IPL-style player auction for your local cricket tournament",
    summary:
      "A step-by-step plan for a local cricket player auction: registration, team owners, purses, auction night and what happens after the gavel.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 6,
    blocks: [
      {
        kind: "paragraph",
        text: "An auction turns team selection into the evening everyone remembers. Owners build their squads in public, with a budget, against each other — and nobody can say the teams were picked by a friend of the organizer. This is how to run one for a local tournament, from the first registration to the morning after.",
      },
      { kind: "heading", level: 2, text: "Three weeks out: open registration" },
      {
        kind: "paragraph",
        text: "Decide the basics first: how many teams, how many players each, and the dates. Then open registration with one link and share it wherever your players already are — usually a WhatsApp group. Ask for the playing role and the batting and bowling style; that is what owners will bid on. The {0} lists the exact questions.",
        links: [{ text: "registration form template", href: "/tools/registration-form" }],
      },
      {
        kind: "list",
        items: [
          {
            text: "Approve players as they register, so the pool you auction is the pool you have checked.",
          },
          {
            text: "Collect the entry fee before the auction, and mark each player paid, pending or waived.",
          },
          { text: "Close registration a few days before the night, so owners can study the pool." },
        ],
      },
      { kind: "heading", level: 2, text: "Two weeks out: owners, purses and rules" },
      {
        kind: "paragraph",
        text: "Pick one owner per team and agree the rules in writing before anyone sees a bid: the purse per team, the minimum and maximum squad, base prices, and whether captains or icon players are placed before the auction. Work the numbers out with the {0} — the reserve rule means an owner's biggest first bid is less than the whole purse.",
        links: [{ text: "purse calculator", href: "/tools/purse-calculator" }],
      },
      {
        kind: "paragraph",
        text: "On DesiAuction the auction's configuration is set once, when you create it, and then locked, so the rules cannot drift on the night. Send each owner their invitation link yourself; once they accept, grant them a paddle so they can bid.",
      },
      { kind: "heading", level: 2, text: "The night" },
      {
        kind: "steps",
        items: [
          {
            text: "Put the auction board on a projector or TV: the player on the block, the current price, and every team's purse and squad.",
          },
          {
            text: "The auctioneer calls each player; owners bid from their own phones, and every screen shows the same bid at the same moment.",
          },
          {
            text: "A bid over a team's purse, below the base price or off the increment is refused, so nobody has to argue about it.",
          },
          { text: "A player nobody bids on passes for now and can come back in a later round." },
        ],
      },
      { kind: "heading", level: 2, text: "After the gavel" },
      {
        kind: "paragraph",
        text: "Each team's squad has its own page to share, what every team owes is worked out from its buys, and the night can be replayed lot by lot. Publish the fixtures and the points table follows every result. The {0} explain each step in the product.",
        links: [{ text: "help guides for auction night", href: "/help/conducting-the-auction" }],
      },
      {
        kind: "callout",
        tone: "info",
        text: "Running cricket? The {0} shows the roles, attributes and table rules the season uses.",
        links: [{ text: "cricket page", href: "/sports/cricket" }],
      },
    ],
  },
  {
    slug: "auction-purse-and-base-price",
    title: "How much purse and base price to set for a player auction",
    summary:
      "How to choose each team's purse and the players' base price for a league auction, with worked numbers and the reserve rule explained.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 5,
    blocks: [
      {
        kind: "paragraph",
        text: "The purse is how much each team may spend; the base price is the least any player can go for. Get the two wrong and the night either ends with three teams unable to fill a squad, or with every player selling at the base price because nobody has room to bid.",
      },
      { kind: "heading", level: 2, text: "Start from the squad, not the purse" },
      {
        kind: "paragraph",
        text: "Every team must be able to buy its minimum squad at the base price, whatever happens earlier in the night. So the floor is simple: purse ≥ minimum squad × base price. A team of 11 at ₹2,000 each needs at least ₹22,000 just to finish.",
      },
      {
        kind: "paragraph",
        text: "Above that floor is the money that makes an auction: what owners can spend on the players they really want. A purse of five times the floor gives owners room to fight for a few stars and still fill the squad.",
      },
      { kind: "heading", level: 2, text: "The reserve rule, worked through" },
      {
        kind: "paragraph",
        text: "An owner may never bid so much that they could not buy the rest of their minimum squad at the base price. With a ₹1,00,000 purse, a minimum squad of 11 and a ₹2,000 base price, the first bid can be at most ₹1,00,000 − 10 × ₹2,000 = ₹80,000. As the squad fills, that ceiling moves.",
      },
      {
        kind: "callout",
        tone: "info",
        text: "Try your own numbers in the {0}. It uses the same rule the live auction enforces.",
        links: [{ text: "purse calculator", href: "/tools/purse-calculator" }],
      },
      { kind: "heading", level: 2, text: "Points instead of rupees" },
      {
        kind: "paragraph",
        text: "If no real money changes hands, run the auction in points. A 1,000-point purse with bids in steps of 5, 10 and 25 feels exactly like a rupee auction, and nobody has to collect anything afterwards.",
      },
      { kind: "heading", level: 2, text: "Three checks before you lock it" },
      {
        kind: "list",
        items: [
          { text: "Teams × minimum squad ≤ approved players, or the last teams cannot finish." },
          { text: "Purse ≥ minimum squad × base price, for every team." },
          { text: "Base prices low enough that the last players in the pool still sell." },
        ],
      },
    ],
  },
  {
    slug: "auction-rules-template",
    title: "Player auction rules: a template for your league",
    summary:
      "A ready-to-adapt set of player auction rules: purses, squad limits, captains, icon and retained players, unsold players and mistakes.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 5,
    blocks: [
      {
        kind: "paragraph",
        text: "Most arguments at an auction are about rules nobody wrote down. Agree these with every owner before the night, share them in writing, and the evening is about players instead of procedure. Adapt the numbers; keep the structure.",
      },
      { kind: "heading", level: 2, text: "1. Money" },
      {
        kind: "list",
        items: [
          { text: "Every team starts with the same purse." },
          { text: "Bids rise in fixed steps, and a bid off the step is not accepted." },
          {
            text: "No team may bid more than it has left, or so much that it cannot complete its minimum squad at the base price.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "2. Squads" },
      {
        kind: "list",
        items: [
          { text: "Each team buys between the minimum and maximum squad size." },
          { text: "A team at its maximum squad stops bidding." },
        ],
      },
      { kind: "heading", level: 2, text: "3. Players placed before the auction" },
      {
        kind: "list",
        items: [
          { text: "Captains join their teams before the auction and are not in the pool." },
          { text: "Icon players, if the league has them, are placed the same way." },
          { text: "Retained players — kept from last season — are placed before the auction too." },
        ],
      },
      { kind: "heading", level: 2, text: "4. Players nobody buys" },
      {
        kind: "paragraph",
        text: "A player with no bid passes for now and comes back in a later round. On any public screen they have passed, not gone unsold; they are someone's teammate next week.",
      },
      { kind: "heading", level: 2, text: "5. Mistakes" },
      {
        kind: "paragraph",
        text: "If a sale lands on the wrong team, the auctioneer reopens it straight away and the correction is recorded rather than erased. Decide in advance who may undo a sale — on DesiAuction it takes an owner-level grant, not just the auctioneer's controls.",
      },
      {
        kind: "callout",
        tone: "info",
        text: "Setting the numbers? See {0} before you lock them in.",
        links: [
          {
            text: "how much purse and base price to set",
            href: "/guides/auction-purse-and-base-price",
          },
        ],
      },
    ],
  },
  {
    slug: "player-registration-form",
    title: "What to ask on a player registration form",
    summary:
      "The questions a tournament's player registration form should ask, what to leave out, and how to word them so the answers are usable.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 4,
    blocks: [
      {
        kind: "paragraph",
        text: "A registration form is the league's first impression and its database. Ask too little and owners bid blind; ask too much and half the players give up on page two. Here is what earns its place.",
      },
      { kind: "heading", level: 2, text: "Always" },
      {
        kind: "list",
        items: [
          { text: "Name, as it should appear on the auction screen and the team sheet." },
          {
            text: "Mobile number — every player needs one, and it is never shown on a public page.",
          },
          {
            text: "Playing role, as a choice from a fixed list rather than a text box, so 'all rounder', 'AR' and 'allrounder' do not become three roles.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "Usually" },
      {
        kind: "list",
        items: [
          { text: "For cricket, batting and bowling style — the detail owners actually bid on." },
          { text: "Date of birth, if you run age groups, or if you need to know who is under 18." },
          {
            text: "A photo, with the player's consent; it makes the auction screen feel like a real auction.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "Only if you will use it" },
      {
        kind: "paragraph",
        text: "Jersey name and number, and T-shirt size, if you are printing kit. Every extra question costs you registrations, so leave out anything you will not act on.",
      },
      { kind: "heading", level: 2, text: "Wording matters" },
      {
        kind: "paragraph",
        text: "If you collect with a Google Form, title each question the way the {0} does and the responses import into DesiAuction without renaming a single column. Choices from a fixed list import cleanly; free text has to be tidied by hand.",
        links: [{ text: "registration form template", href: "/tools/registration-form" }],
      },
      {
        kind: "callout",
        tone: "warning",
        text: "A child's name and photo deserve extra care. A photo is only shown publicly when the player is a known adult, and squad pages stay out of search while any player's age is unproven.",
      },
    ],
  },
  {
    slug: "snake-draft-vs-auction",
    title: "Snake draft or auction: which suits your league?",
    summary:
      "Snake draft or player auction? How each way of picking teams works, what each is good at, and how to choose for your league.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 4,
    blocks: [
      {
        kind: "paragraph",
        text: "Leagues pick teams in two main ways. In a draft, captains take turns choosing one player each. In an auction, owners bid for players against a budget. Both can be fair; they are fair in different ways.",
      },
      { kind: "heading", level: 2, text: "How a snake draft works" },
      {
        kind: "paragraph",
        text: "Teams pick in order, one player each, and the order reverses every round — 1 to 8, then 8 to 1 — so the team that picks last in one round picks first in the next. It is quick, needs no money, and spreads the best players evenly. The {0} works out the order for you.",
        links: [{ text: "snake draft tool", href: "/tools/snake-draft" }],
      },
      { kind: "heading", level: 2, text: "How an auction works" },
      {
        kind: "paragraph",
        text: "Every owner has the same purse. Players come up one at a time and owners bid; the highest bid wins. An owner who values a player more can pay more for them — and will have less for everyone else. A minimum squad and a reserve rule stop anyone from spending the lot on two stars.",
      },
      { kind: "heading", level: 2, text: "Which to choose" },
      {
        kind: "definitions",
        items: [
          {
            term: "Choose a draft when",
            def: "you want it fast, the teams are small, the league is casual, or nobody wants budgets.",
          },
          {
            term: "Choose an auction when",
            def: "you want an event, owners disagree about who is good, or players like seeing what they are worth.",
          },
        ],
      },
      {
        kind: "paragraph",
        text: "DesiAuction runs auctions, not drafts. If you want an auction without money, run it in points: the night is the same and nothing is owed afterwards.",
      },
    ],
  },
  {
    slug: "society-premier-league",
    title: "How to run a society premier league, start to finish",
    summary:
      "Running a housing society premier league: registration across wings, entry fees, a clubhouse auction night, fixtures and keeping residents' details private.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 5,
    blocks: [
      {
        kind: "paragraph",
        text: "A society premier league lives and dies on its committee's evenings. The tournament itself is fun; the spreadsheets, the fee chasing and the 'who is on my team' messages are not. Here is how to keep the fun and lose the admin.",
      },
      { kind: "heading", level: 2, text: "Registration across every wing" },
      {
        kind: "paragraph",
        text: "Post one registration link on the society WhatsApp group and in each wing's group. Residents register on their phones; you approve them as they come in. Set an age rule early — a junior league and a senior league are different events, and a date of birth on the form tells you who is who.",
      },
      { kind: "heading", level: 2, text: "Entry fees before the auction" },
      {
        kind: "paragraph",
        text: "Mark each player's entry fee as pending, paid or waived as it comes in, so the committee knows exactly who still owes before the auction — not a week after. {0} goes deeper.",
        links: [
          { text: "Collecting entry fees and team dues", href: "/guides/collecting-auction-money" },
        ],
      },
      { kind: "heading", level: 2, text: "Auction night in the clubhouse" },
      {
        kind: "list",
        items: [
          { text: "Wing captains are placed in their teams before the auction." },
          { text: "The auction board goes on the clubhouse TV; owners bid from their phones." },
          { text: "Residents who cannot come can watch the public page from home." },
        ],
      },
      { kind: "heading", level: 2, text: "The season" },
      {
        kind: "paragraph",
        text: "Publish the fixtures, enter each result, and the points table keeps itself. The public season page shows teams, squads, fixtures and the table — never a resident's phone number.",
      },
      {
        kind: "callout",
        tone: "info",
        text: "More for housing societies on {0}.",
        links: [{ text: "the society league page", href: "/for/housing-societies" }],
      },
    ],
  },
  {
    slug: "collecting-auction-money",
    title: "Collecting entry fees and team dues without the chaos",
    summary:
      "How to collect players' entry fees and teams' auction dues for a league, record cash and UPI properly, and give receipts people can check.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 5,
    blocks: [
      {
        kind: "paragraph",
        text: "Two kinds of money move in an auction league, and mixing them up is how committees end up paying out of pocket. Players pay an entry fee to take part; teams pay dues for the players they bought. Track them separately.",
      },
      { kind: "heading", level: 2, text: "Entry fees: before the auction" },
      {
        kind: "list",
        items: [
          { text: "Set the fee when you open registration, and say so on the form." },
          {
            text: "Mark each player pending, paid or waived as money arrives, with the UPI reference if there is one.",
          },
          {
            text: "Decide in advance whether an unpaid player goes into the auction. Most leagues say no.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "Team dues: after the gavel" },
      {
        kind: "paragraph",
        text: "In a rupee auction, what each team owes follows from what it bought. Record each payment against that team as cash, UPI or bank transfer, the day it arrives — not from memory at the end of the season.",
      },
      { kind: "heading", level: 2, text: "Receipts people can check" },
      {
        kind: "paragraph",
        text: "Give a receipt for every payment. Receipts numbered in one unbroken series make a missing one obvious, and every receipt can be checked against the original record.",
      },
      { kind: "heading", level: 2, text: "Or take money out of it" },
      {
        kind: "paragraph",
        text: "If the purse is just for the game, run a points auction. Owners bid in points, the night plays the same, and there are no dues to collect afterwards.",
      },
      {
        kind: "callout",
        tone: "info",
        text: "The product side of this is in {0}.",
        links: [{ text: "Money after the gavel", href: "/help/money-after-the-gavel" }],
      },
    ],
  },
  {
    slug: "box-cricket-league",
    title: "How to run a box cricket league with a player auction",
    summary:
      "Running a box cricket or turf league with a player auction: squad sizes, short-format scoring, net run rate and a night at the turf.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 4,
    blocks: [
      {
        kind: "paragraph",
        text: "Box cricket is fast and small: six or eight a side, a few overs, several matches a night. That changes how you run the auction and the season.",
      },
      { kind: "heading", level: 2, text: "Small squads, careful purses" },
      {
        kind: "paragraph",
        text: "With so few players per team, one bad buy is a big share of the side. Keep the gap between the minimum and maximum squad small, and make sure the purse covers the minimum squad at the base price with room to spare. The {0} does the arithmetic.",
        links: [{ text: "purse calculator", href: "/tools/purse-calculator" }],
      },
      { kind: "heading", level: 2, text: "Scoring the short format" },
      {
        kind: "paragraph",
        text: "Record runs, wickets and overs after each match — overs as 6.3, not 6.5, for three balls into the seventh. A win is worth 2 points, a tie or no result 1, and teams level on points are separated by net run rate, which is worked out from the runs and overs you enter.",
      },
      { kind: "heading", level: 2, text: "A night at the turf" },
      {
        kind: "list",
        items: [
          {
            text: "Run the auction at the turf on its own screen, with owners bidding from their phones.",
          },
          { text: "Publish the fixtures by box and time slot so players know when they are on." },
          { text: "Share the public page so the table travels on its own." },
        ],
      },
      {
        kind: "callout",
        tone: "info",
        text: "The roles and table rules are on {0}.",
        links: [{ text: "the box cricket page", href: "/sports/box-cricket" }],
      },
    ],
  },
  {
    slug: "kabaddi-league-auction",
    title: "Running a kabaddi league auction: roles and budgets",
    summary:
      "How to run a kabaddi player auction: registering raiders, defenders and all-rounders, setting budgets, and scoring the league table.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 4,
    blocks: [
      {
        kind: "paragraph",
        text: "The pro leagues made the kabaddi auction famous, and a local league can run the same kind of night. The difference from cricket is the shape of a squad: raiders win points, defenders stop them, and a team short of either loses.",
      },
      { kind: "heading", level: 2, text: "Register by role" },
      {
        kind: "paragraph",
        text: "Ask every player whether they are a raider, a defender or an all-rounder, from a fixed list. The role goes on their auction card, so owners bidding for a squad know exactly whether they are buying a raider or a corner.",
      },
      { kind: "heading", level: 2, text: "Budgets that build whole squads" },
      {
        kind: "paragraph",
        text: "Star raiders go for the most, and an owner who spends everything on two of them has no defence. A minimum squad and the reserve rule stop that from happening by accident: nobody can bid so much that they could not finish their squad at the base price.",
      },
      { kind: "heading", level: 2, text: "The table" },
      {
        kind: "paragraph",
        text: "Enter each team's points after a match. A win is worth 2 and a tie 1, and teams level on points are separated by score difference, then points scored.",
      },
      {
        kind: "callout",
        tone: "info",
        text: "See {0} for the roles and rules the season uses.",
        links: [{ text: "the kabaddi page", href: "/sports/kabaddi" }],
      },
    ],
  },
  {
    slug: "auction-on-a-big-screen",
    title: "How to put a live auction on a projector or TV",
    summary:
      "Putting a live player auction on a projector, a TV or a stream: which screen to open where, and how owners and spectators follow along.",
    publishedOn: TEAM,
    updatedOn: TEAM,
    readMinutes: 4,
    blocks: [
      {
        kind: "paragraph",
        text: "An auction is a room event: the moment a player sells should land on a big screen with everyone watching. Here is how to set up the screens so the night runs itself.",
      },
      { kind: "heading", level: 2, text: "Three screens, three jobs" },
      {
        kind: "definitions",
        items: [
          {
            term: "The cockpit",
            def: "the auctioneer's controls: call a player, watch bids arrive, mark the result.",
          },
          {
            term: "The board",
            def: "the projector screen: who is on the block, the current price, every team's purse and squad, the biggest buys and the last few sales.",
          },
          {
            term: "The overlay",
            def: "a transparent lower-third for streaming software, laid over your camera feed.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "Setting up the room" },
      {
        kind: "steps",
        items: [
          {
            text: "Publish the season before the night, so the board opens on a laptop that is not signed in.",
          },
          {
            text: "Copy the board's link from the cockpit and open it on the laptop plugged into the projector. Leave it running — it has no buttons to press.",
          },
          { text: "Owners bid from their own phones; nobody needs to stand at the laptop." },
          {
            text: "Streaming? Add the overlay's link as a browser source in your streaming software.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "If something drops" },
      {
        kind: "paragraph",
        text: "Every screen follows the same live record. A phone or the projector laptop that loses the network reconnects to exactly where the room is, so nothing has to be repeated.",
      },
      {
        kind: "callout",
        tone: "info",
        text: "The step-by-step is in {0}.",
        links: [{ text: "Screens for the room", href: "/help/screens-for-the-room" }],
      },
    ],
  },
];

export function guide(slug: string): Guide | undefined {
  return GUIDES.find((entry) => entry.slug === slug);
}
