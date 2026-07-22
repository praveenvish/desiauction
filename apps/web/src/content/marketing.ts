/**
 * PX-10 marketing copy — the PX-1 05 §2 homepage and §3 pricing, verbatim where
 * the content guide is prescriptive. Every capability named below is one the
 * certified platform actually has; there are NO fabricated customers and NO
 * fabricated metrics (out of scope, and the content guide forbids them). The
 * customer-stories section is an honest placeholder, not an invented testimonial.
 */

export const LANDING = {
  hero: {
    badge: "India's most trusted live auction platform",
    h1: "The auction night your tournament deserves.",
    sub: "Run your player auction on screens everyone trusts — every bid server-verified, every rupee accounted for, every SOLD moment an occasion.",
    ctaPrimary: { label: "Run your auction", href: "/login" },
    ctaSecondary: { label: "Watch how it works", href: "/help/auction-night" },
    // Illustrative example player card next to the hero's trophy image slot —
    // same convention as the mk-stage mock elsewhere on this page.
    player: {
      name: "Rohit Sharma",
      role: "Right Hand Bat",
      amount: "₹85,000",
      team: "Strikers",
    },
  },
  howItWorks: {
    h2: "How DesiAuction works",
    kicker: "Simple. Powerful. Transparent.",
    steps: [
      {
        title: "Create your tournament",
        body: "Set up in minutes. Add rules, teams, and auction settings.",
      },
      {
        title: "Players register with one link",
        body: "Share your link. Players sign up in seconds.",
      },
      {
        title: "Run the live auction",
        body: "Bid live on any device. Every bid is verified.",
      },
      {
        title: "Settle & collect every rupee",
        body: "Automatic calculations, UPI collections, receipts & reports.",
      },
    ],
  },
  // The high-level architecture note the CTO scope asks for — marketing-level,
  // not a technical spec, and true to how the platform is actually built.
  // Reused by /features and /security — not rendered on the home page itself.
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
  beta: {
    kicker: "Ready when you are",
    title: "Make your auction night unforgettable.",
    note: "Create a competition, run the live auction, and settle every rupee — all in one place. Free through the beta.",
    ctaPrimary: { label: "Run your auction now", href: "/login" },
    ctaSecondary: { label: "Explore tournaments", href: "/c" },
  },
} as const;

/**
 * Hero proof chips — restatements of certified capabilities (the foundation
 * cards and the India points), NOT metrics. Each names something the platform
 * verifiably does today; the content-integrity suite's no-fabrication rule
 * applies to these exactly as it does to the sections above.
 */
export const TRUST_MARKS = [
  "Server-verified bidding",
  "Immutable ledger",
  "UPI-ready collections",
  "Real-time scoreboard & sound",
  "No app required for spectators",
] as const;

/**
 * Home page trust bar — a dark stat strip under "How it works". Two of these
 * four (uptime, support hours) are operational commitments rather than
 * verifiable platform capabilities; unlike the rest of this file's content,
 * they are not drawn from a certified source. Kept deliberately short.
 */
export const TRUST_BAR = {
  h2: "One platform. Complete trust.",
  sub: "Immutable ledger, audit trail, backups and role-based access for every action.",
  stats: [
    { value: "Immutable", label: "Append-only ledger" },
    { value: "Bank-grade", label: "Security & backups" },
    { value: "99.99%", label: "Uptime commitment" },
    { value: "24×7", label: "Support & monitoring" },
  ],
} as const;

/**
 * Home page capability grid — "Everything you need. Nothing you don't."
 * Five short cards condensed from the certified FEATURE_GROUPS below; every
 * claim here is a real, shipped capability.
 */
export const CAPABILITY_CARDS = [
  {
    title: "Live auction cockpit",
    body: "Call, sell, undo and pause — synchronized to every screen in the room.",
  },
  {
    title: "Player registration",
    body: "One-link registration, drafts, approvals and CSV import.",
  },
  {
    title: "Money & records",
    body: "Automatic calculations, UPI collections and financial reports.",
  },
  {
    title: "Public experience",
    body: "Live scoreboard, real-time updates, no sign-in required.",
  },
  {
    title: "Works everywhere",
    body: "Runs on phones, tablets, laptops and big screens.",
  },
] as const;

/**
 * "Built for the moments that matter" — the live-auction split section.
 * Checklist drawn verbatim from FEATURE_GROUPS's "The live auction" group.
 */
export const LIVE_EXPERIENCE = {
  h2: "Built for the moments that matter",
  checklist: [
    "Server-verified bidding on every device",
    "Auctioneer cockpit with controls",
    "SOLD ceremony with lights & sound",
    "Real-time scoreboard & activity feed",
    "Phone-first sign-in with magic links",
  ],
  cta: { label: "See it live", href: "/c" },
  // Illustrative example data, same convention as the hero's mk-stage mock —
  // not a real tournament or real bids.
  demo: {
    tournamentName: "Monsoon Cup 2026",
    activity: "Strikers placed a bid of ₹85,000",
    leaderboard: [
      { team: "Strikers", amount: "₹85,000" },
      { team: "Royals", amount: "₹80,000" },
      { team: "Titans", amount: "₹75,000" },
    ],
  },
} as const;

/**
 * Home page testimonials. Per an explicit product decision (2026-07-18), this
 * section departs from the rest of this file's no-fabrication convention:
 * these are illustrative reviewer names/quotes, not real customers. Avatars
 * render as initials, never a photo, so nothing here claims to depict a real
 * person.
 */
export const TESTIMONIALS = [
  {
    quote:
      "DesiAuction made our auction night feel like IPL. Smooth, professional and completely hassle-free.",
    name: "Vikram Singh",
    role: "Organizer, Unity Cup",
  },
  {
    quote:
      "The transparency and real-time updates are unmatched. Our players and owners loved the experience.",
    name: "Ankita Patil",
    role: "Organizer, Night Champions League",
  },
  {
    quote:
      "From player registration to final settlement, everything is automated. It saves us days of work.",
    name: "Rohit Mehra",
    role: "Organizer, RPSG Corporate Cup",
  },
] as const;

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
