/**
 * PX-10 marketing copy — the PX-1 05 §2 homepage and §3 pricing, verbatim where
 * the content guide is prescriptive. Every capability named below is one the
 * certified platform actually has; there are NO fabricated customers and NO
 * fabricated metrics (out of scope, and the content guide forbids them). The
 * customer-stories section is an honest placeholder, not an invented testimonial.
 */

export const LANDING = {
  hero: {
    h1: "The auction night your tournament deserves.",
    sub: "Run your player auction on screens everyone trusts — every bid server-verified, every rupee accounted for, every SOLD moment an occasion.",
    ctaPrimary: { label: "Run your auction", href: "/login" },
    ctaSecondary: { label: "Watch how it works", href: "/help/auction-night" },
  },
  problem: {
    h2: "Spreadsheets ruin auction night",
    quotes: ["“That bid was mine.”", "“Your sheet says ₹80,000, mine says ₹85,000.”"],
    body: "Every organizer knows the week after the auction — defending arithmetic on WhatsApp. It doesn't have to be like this.",
  },
  promises: {
    h2: "Three promises",
    cards: [
      {
        title: "One truth on every screen",
        body: "Bids are validated on the server and land on the projector, every owner's phone, and every spectator's screen at the same instant. There is nothing to dispute.",
      },
      {
        title: "The night feels like television",
        body: "The SOLD moment is a synchronized ceremony. Players hear their names called into an occasion, not read off a cell.",
      },
      {
        title: "The books close themselves",
        body: "Purses, dues, receipts, and an immutable ledger — done when the gavel falls, exportable to your accountant.",
      },
    ],
  },
  howItWorks: {
    h2: "How it works",
    steps: [
      "Create your competition",
      "Players register with one link",
      "Run the live auction",
      "Collect and receipt every rupee",
    ],
  },
  // The high-level architecture note the CTO scope asks for — marketing-level,
  // not a technical spec, and true to how the platform is actually built.
  foundation: {
    h2: "Built on one source of truth",
    cards: [
      {
        title: "Server-verified",
        body: "Every bid is checked on the server before it counts. Screens display the outcome — they don't decide it.",
      },
      {
        title: "Immutable ledger",
        body: "The auction and the money are an append-only record. Nothing is edited after the fact; corrections are new entries that explain themselves.",
      },
      {
        title: "Recovers itself",
        body: "The room's state lives on the server as a snapshot. A dropped phone reconnects to exactly where things are — nothing missed.",
      },
    ],
  },
  india: {
    h2: "Built for Indian tournaments",
    points: [
      "UPI-first collections",
      "₹ everywhere",
      "Devanagari-ready names",
      "Phone-number sign-in — no email required",
    ],
  },
  // No fabricated customers or metrics — an honest placeholder (PX-1 content debt).
  stories: {
    h2: "Customer stories",
    body: "We're in beta with our first tournaments now. Real stories from real organizers will appear here as they finish their seasons — no stock quotes, no invented numbers.",
  },
  beta: {
    note: "DesiAuction is in beta. Every tournament gets full features, free, while we earn your trust.",
    ctaPrimary: { label: "Run your auction", href: "/login" },
    ctaSecondary: { label: "Explore competitions", href: "/c" },
  },
} as const;

export interface PricingTier {
  readonly name: string;
  readonly price: string;
  readonly cadence: string;
  readonly limits: string;
  readonly highlights: readonly string[];
  readonly featured?: boolean;
}

export const PRICING = {
  h1: "Simple, public pricing.",
  sub: "You buy a Pass per tournament — no subscriptions, no seats, no “contact sales”.",
  betaBanner:
    "During beta, everything is free. Paid Passes arrive with general availability at these published prices — tournaments started during beta stay free forever.",
  trustLine:
    "Trust is never premium: the immutable ledger, receipts, and audit are in every tier, including Free.",
  tiers: [
    {
      name: "Free",
      price: "₹0",
      cadence: "always",
      limits: "Up to 4 teams and 40 players",
      highlights: [
        "The full live auction, cockpit and public stage",
        "Settlement, receipts and invoices",
        "Immutable ledger, audit and exports",
      ],
    },
    {
      name: "Pro Pass",
      price: "Published at GA",
      cadence: "per tournament",
      limits: "Up to 16 teams and 400 players",
      highlights: [
        "Everything in Free",
        "Custom branding and auction overlays",
        "Larger tournaments",
      ],
      featured: true,
    },
    {
      name: "Association",
      price: "Published at GA",
      cadence: "bundle",
      limits: "Multiple tournaments across a season",
      highlights: [
        "Everything in Pro Pass",
        "Bundled passes for an association's season",
        "One relationship, many tournaments",
      ],
    },
  ] satisfies readonly PricingTier[],
  faqs: [
    {
      question: "Why passes, not subscriptions?",
      answer:
        "A tournament is an event, not a monthly habit. You pay once, for the tournament you're running — no seats to count, no subscription to remember to cancel.",
    },
    {
      question: "What happens when my pass expires?",
      answer:
        "Your data is never held hostage — everything stays readable and exportable, forever. A pass covers running the auction; the records are yours to keep.",
    },
    {
      question: "Refunds?",
      answer: "Full refund until your auction goes live. After that the pass is consumed.",
    },
  ],
} as const;

export const FEATURE_GROUPS = [
  {
    title: "Registration",
    features: [
      "One-link player registration with saved drafts",
      "Approve, waitlist or decline — each with a notification",
      "CSV roster import with row-by-row validation",
      "Public competition directory when you choose to publish",
    ],
  },
  {
    title: "The live auction",
    features: [
      "Server-verified bidding on every device at once",
      "Auctioneer cockpit with call, sell, undo, pause",
      "Synchronized SOLD ceremony with the player's name",
      "Self-healing recovery from a server snapshot",
      "Public spectator stage — no sign-in required",
    ],
  },
  {
    title: "Money & records",
    features: [
      "Obligations computed automatically when the gavel falls",
      "Record cash, UPI and bank collections against dues",
      "Receipts, invoices and corrections with real numbering",
      "Tally-compatible exports, verified against the ledger",
      "Fiscal periods and year-end close",
    ],
  },
  {
    title: "Trust & governance",
    features: [
      "Grants, not roles — money authority is always deliberate",
      "Immutable, append-only ledger and audit trail",
      "Phone-first sign-in with passkeys",
      "Platform administration for observability and support",
    ],
  },
] as const;
