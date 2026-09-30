/**
 * THE COMPARISON PAGES (SEO-1 Phase 4c) — `/compare` and `/compare/[slug]`.
 *
 * GENERIC ONLY (founder, 2026-09-30). Each page compares DesiAuction with how
 * leagues run WITHOUT a product — a spreadsheet and a WhatsApp group, or a
 * manual auction with chits and a whiteboard. No competitor is named, so there
 * is nothing about anyone else's product to verify or to go stale.
 *
 * FAIR TO THE OLD WAY. Every "without" cell describes what really happens, not
 * a straw man, and every page says when the old way is genuinely enough. A
 * comparison that only ever wins reads as an ad and earns no trust.
 *
 * TRUE OF THE PRODUCT. Every "with" cell was checked in code before it was
 * written:
 *   bids refused below base / below current / off-increment / over purse /
 *     breaking the reserve rule           packages/core/src/auction.ts (bid checks)
 *   one registration per player a season   registrations_competition_person_uq
 *   round-robin generation, double-booked team or ground refused
 *                                          server/competition/fixture-aggregate.ts
 *   undo reopens a sold lot as a new event packages/core/src/auction.ts ("compensating")
 *   replay of the night                    app/seasons/[slug]/auction/replay
 *   player and schedule CSV exports        _players/export-dialog, fixtures/schedule-panel
 *   cash/UPI/bank + numbered receipts, fee status per player, points auctions,
 *   WhatsApp share LINKS (not automated sending), Google Form import.
 */

export interface ComparisonRow {
  /** What is being compared, in a word or two. */
  readonly aspect: string;
  /** How it goes without a product — fairly. */
  readonly without: string;
  /** How it goes on DesiAuction — only what is built. */
  readonly with: string;
}

export interface ComparisonFaq {
  readonly question: string;
  readonly answer: string;
}

export interface ComparisonPage {
  readonly slug: string;
  /** Short name of the old way, for the table header and the hub card. */
  readonly oldWay: string;
  /**
   * The old way inside a sentence ("compare with a manual auction"). Written,
   * not derived: lowercasing "WhatsApp" is how a brand name gets misspelt.
   */
  readonly inSentence: string;
  /** The heading over `enough`, with its own grammar ("are" for two things). */
  readonly enoughTitle: string;
  readonly title: string;
  readonly headline: string;
  /** Meta description: 50–160 characters. */
  readonly description: string;
  readonly lede: string;
  readonly rows: readonly ComparisonRow[];
  /** When the old way is enough — said plainly. */
  readonly enough: string;
  readonly faqs: readonly ComparisonFaq[];
  readonly updatedOn: string;
}

export const COMPARISON_PAGES: readonly ComparisonPage[] = [
  {
    slug: "spreadsheet-and-whatsapp",
    oldWay: "Spreadsheet + WhatsApp group",
    inSentence: "a spreadsheet and a WhatsApp group",
    enoughTitle: "When a spreadsheet and a WhatsApp group are enough",
    title: "Spreadsheet and WhatsApp vs DesiAuction",
    headline: "A spreadsheet and a WhatsApp group, or DesiAuction?",
    description:
      "How running a league on a Google Sheet and a WhatsApp group compares with DesiAuction: registration, the auction, fixtures, the table and the money.",
    lede: "Most leagues start the same way: a Google Form, a sheet somebody owns, and a WhatsApp group that becomes the league's memory. It works — until the sheet has three versions and nobody can find who paid.",
    rows: [
      {
        aspect: "Registration",
        without:
          "A Google Form feeds a sheet. Someone cleans duplicates and chases missing roles by hand.",
        with: "One registration link. A player can register once per season, and roles and styles come from a fixed list. An existing Google Form's responses can be imported.",
      },
      {
        aspect: "Approvals",
        without:
          "A column in the sheet, updated by whoever remembers, and messages sent one by one.",
        with: "Approve, waitlist or decline each player on the registration desk, and each decision sends the player a notification.",
      },
      {
        aspect: "Entry fees",
        without: "Screenshots of UPI payments in the group, matched to names later.",
        with: "Each player's fee is marked pending, paid or waived on the desk, so the list of who still owes is always current.",
      },
      {
        aspect: "Auction night",
        without:
          "Bids are called out and typed into the sheet; the purse is worked out on a calculator.",
        with: "Owners bid from their phones. A bid over a team's purse, below the base price or off the increment is refused, and every screen shows the same bid.",
      },
      {
        aspect: "After the auction",
        without: "Someone types up the squads and posts a photo of the sheet in the group.",
        with: "Each team's squad has its own public page, and players and teams get share cards made for WhatsApp.",
      },
      {
        aspect: "Fixtures and table",
        without: "A fixtures tab and a points tab, each edited by hand after every match.",
        with: "Round-robin fixtures are generated, a double-booked team or ground is refused, and the table updates from each result.",
      },
      {
        aspect: "The money",
        without:
          "Who owes what is worked out from the sheet; payments are remembered, not recorded.",
        with: "What each team owes is set when the gavel falls, collections are recorded as cash, UPI or bank, and receipts are numbered.",
      },
    ],
    enough:
      "A sheet and a group are enough for a one-off friendly between a few teams whose players all know each other, with no auction and no money changing hands. The more players, teams and rupees there are, the more a single shared record matters.",
    faqs: [
      {
        question: "Can I bring my Google Form responses across?",
        answer:
          "Yes. Import the responses and the columns are matched for you: name, phone and role, plus each sport's own details, such as batting style, preferred foot or playing hand. Each row is checked before anything is saved.",
      },
      {
        question: "Do we still use our WhatsApp group?",
        answer:
          "Yes — for talking. The registration link, the auction's public page and each season's page share into the group in one tap, so the group points at one up-to-date record instead of being it.",
      },
      {
        question: "Can we export our data back to a spreadsheet?",
        answer: "Yes. The player list and the fixture schedule can both be downloaded as CSV.",
      },
    ],
    updatedOn: "2026-09-30",
  },
  {
    slug: "manual-auction",
    oldWay: "Manual auction",
    inSentence: "a manual auction",
    enoughTitle: "When a manual auction is enough",
    title: "Manual player auction vs DesiAuction",
    headline: "Chits and a whiteboard, or a live auction app?",
    description:
      "How a manual player auction — chits, a whiteboard and called-out bids — compares with running it live on DesiAuction, bid by bid and purse by purse.",
    lede: "A manual auction has real theatre: an auctioneer with a mic, owners with paddles, a whiteboard of purses. What it lacks is a record anyone can check once the room goes home.",
    rows: [
      {
        aspect: "Calling a player",
        without: "The auctioneer reads a name off a chit or a printed list.",
        with: "The auctioneer calls the next player from the auction controls, and their role, base price and photo go up on the board and every owner's phone.",
      },
      {
        aspect: "Bids",
        without: "Paddles go up and the auctioneer decides who was first.",
        with: "Bids are checked by the server and reach every screen at once, so the order is not a judgement call.",
      },
      {
        aspect: "Purse",
        without: "A helper updates each team's remaining purse on a whiteboard.",
        with: "Each team's remaining purse is on the board, and a bid the team cannot afford is refused before it is shown.",
      },
      {
        aspect: "Squad limits",
        without: "Someone counts each squad and hopes nobody overspends early.",
        with: "A team at its maximum squad cannot bid, and the reserve rule refuses a bid that would leave it unable to fill its minimum squad.",
      },
      {
        aspect: "Mistakes",
        without: "A wrong sale is crossed out, and people remember it differently the next day.",
        with: "A sale can be reopened, and the reopening is recorded as its own event rather than erasing the first.",
      },
      {
        aspect: "The record",
        without: "The whiteboard is photographed, and the photo is the record.",
        with: "Every bid and sale is kept, and the night can be replayed lot by lot.",
      },
    ],
    enough:
      "A manual auction is enough for a small room where every owner is present, the purses are small, and nobody will ask afterwards what the fourth bid on the sixth player was. It stops being enough when owners bid remotely, when the money is real, or when the result will be argued about.",
    faqs: [
      {
        question: "Do we lose the atmosphere of a live auction?",
        answer:
          "No. The auctioneer still runs the room and the board goes on the big screen — the app just keeps the bids, purses and squads right while the room enjoys it.",
      },
      {
        question: "What if an owner doesn't have a smartphone?",
        answer:
          "Owners bid from any phone with a browser. An owner who cannot bid from a phone can sit with someone who can, the way paddles are shared today.",
      },
      {
        question: "Can we fix a sale that went to the wrong team?",
        answer:
          "Yes. The auctioneer can reopen a sold player; the reopening is recorded, so the correction is visible rather than silent.",
      },
    ],
    updatedOn: "2026-09-30",
  },
];

export function comparisonPage(slug: string): ComparisonPage | undefined {
  return COMPARISON_PAGES.find((page) => page.slug === slug);
}
