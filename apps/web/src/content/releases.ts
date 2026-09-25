/**
 * Release notes, for visitors.
 *
 * Factual history of what the product delivered, newest first — no roadmap
 * promises, no metrics, and no internal vocabulary. Every entry is written from
 * the commits that shipped it (`git log origin/main`), in the words an organizer
 * or a player would use: the old milestone-by-milestone list read like an
 * engineering changelog ("grants", "projections", "certified engines") and told
 * a visitor nothing about what they could now do.
 *
 * `version` doubles as the section's anchor id on /releases, so each one must be
 * unique; it names the part of the product the entry is about. The live version
 * string comes from env.APP_VERSION, surfaced by the page (not hard-coded here).
 */

export interface ReleaseNote {
  readonly version: string;
  readonly title: string;
  readonly date: string;
  readonly highlights: readonly string[];
}

export const RELEASES: readonly ReleaseNote[] = [
  {
    version: "Auctions",
    title: "Points auctions, and a quicker first night",
    date: "25 Sep 2026",
    highlights: [
      // Points seasons settle nothing: the settlement lane refuses them, so the
      // highlight says so rather than letting "purse" imply money.
      "Run an auction in points instead of rupees: purses and bids count in points, and no money is owed or collected afterwards.",
      "Put every unsold player back in the queue with one press, from the auctioneer's controls.",
      "Approve everyone waiting for a decision in one go.",
      "A new club is guided straight from “Create your tournament” to setting up its first season.",
    ],
  },
  {
    version: "Registration",
    title: "Google Form import and WhatsApp sharing",
    date: "25 Sep 2026",
    highlights: [
      "Import players straight from a Google Form, and bring in new sign-ups each week without starting over.",
      "Player photos come across from Google Drive — from each row's own link, or from the folder as a zip.",
      "Share your registration link on WhatsApp with the message already written.",
    ],
  },
  {
    version: "Sharing",
    title: "Share cards for players and teams",
    date: "24 Sep 2026",
    highlights: [
      "Every signed player gets a card to share — with the price they went for, in six looks, and as a short video for a WhatsApp Status.",
      "Every squad has its own public page once the tournament is published.",
      "The emails after an auction invite players to share their card.",
    ],
  },
  {
    version: "Auction night",
    title: "A louder auction room",
    date: "Sep 2026",
    highlights: [
      "A SOLD that lands: the stamp, the rolling price and sound, on every screen in the room at once.",
      "Appoint an auctioneer to run the night, even if they don't own a team.",
      "Sign in with your email address and a one-time code — no password — alongside mobile number and passkeys.",
      "Record who played each match, and let players review the tournament once it's over.",
    ],
  },
  {
    version: "Sports",
    title: "Twelve sports, and a private plan for owners",
    date: "Sep 2026",
    highlights: [
      "Seasons for 12 sports — cricket, box cricket, football, kabaddi, volleyball, hockey, basketball, badminton, table tennis, pickleball, esports and battle royale — each speaking its own sport's language.",
      "Team owners get “My plan”: a private shortlist and budget for auction night that no one else in the room can see.",
    ],
  },
  {
    version: "Foundation",
    title: "Registration, the live auction and the books",
    date: "Jul–Aug 2026",
    highlights: [
      "One-link player registration with saved drafts, approvals and a waitlist.",
      "Live bidding from every owner's phone, with an auctioneer's console, undo and pause.",
      "A big-screen board for the hall, a stream overlay, and a public page anyone can watch without signing in.",
      "Dues worked out when the gavel falls, collections recorded as cash, UPI or bank, and numbered receipts.",
      "Sign-in with a one-time code, and passkeys for one-tap sign-in after that.",
    ],
  },
];
