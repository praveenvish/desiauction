/**
 * PX-10 Release Notes.
 *
 * Factual history of what the product actually delivered, milestone by
 * milestone — no roadmap promises, no metrics. Each entry describes shipped,
 * certified capability. The live version string comes from env.APP_VERSION,
 * surfaced by the page (not hard-coded here).
 */

export interface ReleaseNote {
  readonly version: string;
  readonly title: string;
  readonly date: string;
  readonly highlights: readonly string[];
}

export const RELEASES: readonly ReleaseNote[] = [
  {
    version: "Beta · Product complete",
    title: "The customer-facing product",
    date: "Jul 2026",
    highlights: [
      "A complete public experience: landing, pricing, help centre, legal centre and support.",
      "Help articles covering the whole journey — setup, registration, the auction, settlement and finance.",
      "Coherent navigation across marketing, help, legal and the app, with search that reaches every public destination.",
    ],
  },
  {
    version: "Beta · Platform administration",
    title: "Observability and governance",
    date: "Jul 2026",
    highlights: [
      "A read-only platform console for operators: organizations, users, auctions, settlements and finance at a glance.",
      "A platform audit explorer and a live health view across background workers and delivery.",
      "Read-only by design — administration observes; every operational fix stays in the console that owns it.",
    ],
  },
  {
    version: "Beta · Financial operations",
    title: "Documents, delivery and the books",
    date: "Jul 2026",
    highlights: [
      "Receipts, invoices and corrections with real numbering, delivered to the recipient's inbox.",
      "Tally-compatible exports, each verified against the ledger it came from.",
      "Fiscal periods and a year-end close, with the finance workspace showing what still needs a human.",
    ],
  },
  {
    version: "Beta · Settlement",
    title: "The money desk",
    date: "Jul 2026",
    highlights: [
      "A settlement case opens automatically when the auction completes, obligations already computed.",
      "Record cash, UPI and bank collections; waive and adjust under a controller grant; close with an immutable evidence package.",
      "A closure ceremony marks the books officially done.",
    ],
  },
  {
    version: "Beta · Live auction",
    title: "Auction night",
    date: "Jul 2026",
    highlights: [
      "Server-verified bidding that lands on every screen at once, with an auctioneer cockpit.",
      "A synchronized SOLD ceremony, undo, pause, and self-healing recovery from a server snapshot.",
      "A public spectator stage that needs no sign-in.",
    ],
  },
  {
    version: "Beta · Registration & organizer workspace",
    title: "Setting up and signing up",
    date: "Jul 2026",
    highlights: [
      "Organizer workspace: teams, a readiness centre, and grant management.",
      "One-link player registration with saved drafts, approvals, waitlists and CSV import.",
      "A public competition directory for the tournaments you publish.",
    ],
  },
  {
    version: "Beta · Foundation",
    title: "Identity, the shell and the auction engine",
    date: "2026",
    highlights: [
      "Phone-first sign-in with passkeys, and the grants-not-roles authorization model.",
      "The product shell: one navigation model across public, console and live surfaces.",
      "The certified auction, settlement and financial-operations engines beneath it all.",
    ],
  },
];
