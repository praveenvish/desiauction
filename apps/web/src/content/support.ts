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
      // The address alone: the old detail appended "— subject line: AUCTION
      // NIGHT", which rendered as one two-line underlined link with prose
      // inside it. The href pre-fills the subject, and the note below already
      // says why it matters.
      detail: "support@desiauction.in",
      href: "mailto:support@desiauction.in?subject=AUCTION%20NIGHT",
      note: "If something is wrong during a live auction, put AUCTION NIGHT in the subject line — those go to the front of the queue. The link pre-fills it.",
    },
  ],
  issueCategories: [
    {
      title: "I can't sign in",
      // The old answer was circular: it sent someone who cannot sign in to add
      // a passkey, and passkey enrolment is on /account, which redirects to
      // /login without a session. It also hid the numbers that explain the
      // silence at the phone step. Both fixed: the real limits (from
      // server/auth/otp.ts) first, and the passkey named as prevention for next
      // time rather than as a way out of this.
      body: "A code lasts five minutes; you can ask for another after 30 seconds, up to five an hour, and five wrong entries lock that number for a while. If the screen has gone quiet you have probably hit one of those limits — waiting an hour clears it. Check the number you typed and your SMS filters, and email us if you are still stuck.",
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
