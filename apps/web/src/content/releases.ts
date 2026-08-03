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
      // Was "covering the whole journey". Three shipped features had no article
      // at all — icons/captains/coaches, the broadcast surfaces, and what
      // becomes public when you publish. They have articles now; the claim is
      // still stated as a set of guides rather than as total coverage.
      "Help articles for setup, registration, the auction night, the screens for the room, settlement and finance.",
      // Was "search that reaches every public destination", while the index
      // omitted eleven live pages — including /security, which the query
      // "security" could not find.
      "Coherent navigation across marketing, help, legal and the app, with a search index over every public page.",
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
    // Three announcements retired as UNDELIVERED. Release notes are the one
    // surface a reader treats as a record of fact, so an entry that announces a
    // capability nobody can reach is the most expensive sentence on the site.
    //   • invoices — the issuance lane tells its own operator "This lane will
    //     not be able to issue anything" when the profile is GST-registered;
    //   • "delivered to the recipient's inbox" — lib/inbox-events.ts is the
    //     complete label map and carries no finance event at all;
    //   • Tally exports — reachable from no screen (zero non-test hits for
    //     exportRun / requestExport / buildExportArtifact / ExportKind);
    //   • the year-end close — the help centre lists "Sealing a financial year"
    //     under "What isn't here yet", and it is right.
    highlights: [
      "Receipts numbered in an unbroken series per kind and per financial year, and sealed when issued.",
      "Every issued document re-derivable from the events behind it and checked against the seal it was given.",
      "A finance workspace that shows what still needs a human — and says plainly what it cannot do yet.",
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
      "A public tournament directory for the tournaments you publish.",
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
