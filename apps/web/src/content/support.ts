/**
 * PX-10 Support experience (static routing only — no ticketing backend, per
 * scope). Contact channels, issue categories, bug-reporting guidance, a link to
 * system status, and the version/release information. Every channel is real; no
 * form here pretends to file a ticket.
 */

export const SUPPORT = {
  intro:
    "We answer in person during beta. Tell us what's happening and we'll get back within a day — faster on auction night.",
  channels: [
    {
      title: "Email",
      detail: "support@desiauction.in",
      href: "mailto:support@desiauction.in",
      note: "The best channel for anything that isn't urgent. Include your competition name if you have one.",
    },
    {
      title: "Auction-night help",
      detail: "support@desiauction.in — subject line: AUCTION NIGHT",
      href: "mailto:support@desiauction.in?subject=AUCTION%20NIGHT",
      note: "If something is wrong during a live auction, say so in the subject line. Those go to the front of the queue.",
    },
  ],
  issueCategories: [
    {
      title: "I can't sign in",
      body: "Codes are valid for five minutes, and there's a limit on how many you can request in a row. If you're stuck, a passkey avoids codes entirely — or email us and we'll help.",
      link: { label: "Read: signing in & passkeys", href: "/help/signing-in" },
    },
    {
      title: "Something's wrong on auction night",
      body: "Pause the auction from the cockpit — spectators see a calm message, and nothing is lost. Then email us with AUCTION NIGHT in the subject.",
      link: { label: "Read: conducting the auction", href: "/help/conducting-the-auction" },
    },
    {
      title: "A payment or receipt looks wrong",
      body: "The ledger is never edited — corrections are new entries. Check the case and document register first, then reach out if it still looks off.",
      link: { label: "Read: money after the gavel", href: "/help/money-after-the-gavel" },
    },
    {
      title: "I can't see the money desk",
      body: "The settlement and finance desks need their own grant — owning an organization isn't enough. Ask your organizer to grant it.",
      link: { label: "Read: money after the gavel", href: "/help/money-after-the-gavel" },
    },
  ],
  bugReporting: {
    title: "Reporting a bug",
    intro: "A good report gets a fast fix. When something breaks, tell us:",
    checklist: [
      "What you were doing, step by step, when it happened.",
      "What you expected, and what happened instead.",
      "The competition or organization name, and roughly when.",
      "Your device and browser (for example, “iPhone, Safari”).",
      "A screenshot if you can — it often shows us the answer immediately.",
    ],
  },
} as const;
