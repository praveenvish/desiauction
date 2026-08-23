import type { Block } from "./blocks";
import { LEGAL_IDENTITY, legalIdentityPublished } from "./company";

/**
 * PX-10 Legal Centre.
 *
 * Structure ships as written; the words are the PX-1 05 §9 skeletons, which the
 * content guide marks "founder/legal to ratify". These are therefore HONEST
 * BETA DRAFTS — each carries a version and effective date, and the Legal Centre
 * says plainly that the documents are beta drafts pending legal review. PX-10
 * exposes supplied legal content and interprets nothing; where a fact is set at
 * deployment (the exact data processors), the draft names the category and says
 * the specifics are listed at launch (PX-1 content debt §13).
 */

export interface LegalVersion {
  readonly version: string;
  readonly date: string;
  readonly note: string;
}

export interface LegalDocument {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly effective: string;
  readonly versions: readonly LegalVersion[];
  readonly blocks: readonly Block[];
}

const BETA_DRAFT: LegalVersion = {
  version: "0.1 (beta draft)",
  date: "16 Jul 2026",
  note: "Initial beta draft. Structure is final; wording is under legal review and may change before general availability.",
};

const DRAFT_NOTICE: Block = {
  kind: "callout",
  tone: "warning",
  text: "This is a beta draft. DesiAuction is in beta; this document's wording is under legal review and may change before general availability. We will publish a new version here, with its date, whenever it does.",
};

/**
 * WHO IS OFFERING THESE DOCUMENTS.
 *
 * Eight legal documents named no legal entity, no address and no grievance
 * officer — the three things an India-facing platform is actually required to
 * publish (see `company.ts` for the rules). Rather than a blank or a guess, the
 * identity renders whatever is set and says plainly what is not, so the gap is
 * visible on the page instead of only in a backlog. `preflight:production`
 * refuses a deploy while anything required is still missing.
 */
function identityBlocks(): readonly Block[] {
  const id = LEGAL_IDENTITY;
  if (!legalIdentityPublished()) {
    return [
      {
        kind: "callout",
        tone: "warning",
        text: "DesiAuction is in beta and its operating entity's registered details are not published here yet. Until they are, every question — legal, privacy or a complaint — goes to the addresses on this page, and we answer them ourselves. If you need our registered details before you can proceed, write to us and we will send them to you.",
      },
    ];
  }
  const items: { term: string; def: string }[] = [
    { term: "Operator", def: id.legalName ?? "" },
    ...(id.registrationNumber !== null
      ? [{ term: "Registration", def: id.registrationNumber }]
      : []),
    { term: "Registered address", def: id.registeredAddress ?? "" },
    ...(id.gstin !== null ? [{ term: "GSTIN", def: id.gstin }] : []),
    {
      term: "Grievance Officer",
      def: `${id.grievanceOfficerName ?? ""}, ${id.grievanceOfficerEmail ?? ""}${
        id.grievanceOfficerPhone !== null ? `, ${id.grievanceOfficerPhone}` : ""
      }`,
    },
  ];
  return [{ kind: "definitions", items }];
}

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    slug: "terms",
    title: "Terms of Service",
    summary: "The agreement between you and DesiAuction for using the platform.",
    effective: "16 Jul 2026",
    versions: [BETA_DRAFT],
    blocks: [
      DRAFT_NOTICE,
      { kind: "heading", level: 2, text: "The service" },
      {
        kind: "paragraph",
        text: "DesiAuction is a platform for running tournament player auctions: registration, a live auction, and the settlement and records that follow. We provide the software and the record-keeping; we do not run your tournament or handle your money for you.",
      },
      { kind: "heading", level: 2, text: "Your account" },
      {
        kind: "paragraph",
        text: "An account is a verified Indian mobile number. You are responsible for the activity under your number and for keeping access to it. Do not share your sign-in codes with anyone.",
      },
      { kind: "heading", level: 2, text: "Organizer responsibilities" },
      {
        kind: "paragraph",
        text: "If you organize a tournament, you run the money — collecting payments and issuing what you owe your participants. DesiAuction records these events faithfully and immutably, but the underlying obligations, collections and refunds are between you and your participants.",
      },
      { kind: "heading", level: 2, text: "Acceptable use" },
      {
        kind: "list",
        items: [
          { text: "Use the platform only for genuine tournaments and their participants." },
          { text: "Do not attempt to access data or capabilities you have not been granted." },
          { text: "Do not disrupt the service or the auctions of others." },
        ],
      },
      { kind: "heading", level: 2, text: "Beta" },
      {
        kind: "paragraph",
        text: "During beta, the service is provided free of charge and with full features. Your data remains yours and portable. Tournaments started during beta remain free even after paid plans launch.",
      },
      { kind: "heading", level: 2, text: "Liability" },
      {
        kind: "paragraph",
        text: "The platform is provided as-is during beta. To the extent permitted by law, our liability for any claim arising from your use of the service is limited to the amount you paid us for it — which, during beta, is nil.",
      },
      { kind: "heading", level: 2, text: "Governing law" },
      {
        kind: "paragraph",
        text: "These terms are governed by the laws of India. Any dispute is subject to the exclusive jurisdiction of the courts of Mumbai, Maharashtra.",
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary: "What we store, why, and your control over it.",
    effective: "16 Jul 2026",
    versions: [BETA_DRAFT],
    blocks: [
      DRAFT_NOTICE,
      { kind: "heading", level: 2, text: "What we store" },
      {
        kind: "list",
        items: [
          { text: "Your mobile number and name." },
          { text: "Registration details you submit to a season." },
          { text: "Auction and settlement records for tournaments you take part in." },
        ],
      },
      { kind: "heading", level: 2, text: "Why we store it" },
      {
        kind: "paragraph",
        text: "To run your tournaments: to sign you in, to place you in seasons, to conduct auctions, and to keep an accurate, disputable-free record of the money. We do not sell your data to anyone, ever.",
      },
      // This policy disclosed NONE of the publication that actually happens: a
      // published season renders a public player pool, and every approved
      // player gets a link-shareable profile page with a preview card. A
      // privacy policy that omits the one place personal data becomes public is
      // the wrong document to be silent in.
      { kind: "heading", level: 2, text: "What becomes public" },
      // This sentence was FALSE when it was written. A season was also published
      // by `status = 'registration_open'` — an operational click with no publish
      // dialog — so nineteen seasons their organizers had marked private were
      // serving complete rosters. The gate is now visibility and nothing else
      // (server/competition/public.ts), which is what makes the first sentence
      // below true; the code change landed first, deliberately, so the policy
      // was never the thing out in front. The rest names every surface, because
      // "the season's page" was not the whole disclosure either — the profile
      // pages, the preview cards and a bulk export were all part of it.
      {
        kind: "paragraph",
        text: "A season is private until its organizer publishes it. Publishing is a single, deliberate decision they make on the season itself — nothing else does it, and opening registration does not. Until they publish, none of the pages below exist for anyone outside the organizing team, and the season's address returns the same not-found page as an address that was never created.",
      },
      {
        kind: "paragraph",
        text: "When they publish, four things become readable by anyone with the link, with no account and no sign-in: the season's own page, listing the approved player pool, the teams and their squads, and any fixtures published; a page of their own for each approved player, carrying their name, registration number, playing role, age where a date of birth was given, playing styles where given, their photo if they uploaded one, and which team signed them; a preview card generated for each of those pages, so a name and a playing role travel with the link into a messaging app; and the live auction, the venue board and the broadcast overlay while the auction is running.",
      },
      {
        kind: "paragraph",
        text: "Player pages are marked not to be indexed by search engines, so they do not turn up in web searches — they are built to be shared as links, not found by strangers. Nobody can download the player pool as a file from a public page. Organizers can export the registrations for their own season, and every export is recorded against the person who took it.",
      },
      {
        kind: "paragraph",
        text: "Your mobile number is never published, on any page, whether or not a season is published. Publication is the organizer's decision on their tournament, so tell them before they publish if you do not want your details public — but you do not have to rely on that: withdrawing your registration, from the season's registration page, removes you from the player pool and takes your player page and its preview card down with it.",
      },
      { kind: "heading", level: 2, text: "Who processes it" },
      {
        kind: "paragraph",
        text: "We use a small number of service providers to operate the platform — hosting, SMS delivery for sign-in codes, and error monitoring. Each is named, with its role, in the version of this policy published at launch. We share only what each provider needs to do its job.",
      },
      { kind: "heading", level: 2, text: "Retention and deletion" },
      {
        kind: "paragraph",
        text: "Financial ledgers are immutable and retained as a matter of record. You may request deletion of your account; where records must be retained, your personal identifiers are anonymized rather than the record destroyed. See our Data Retention policy for specifics.",
      },
      // The policy described deletion and nothing else. The Digital Personal
      // Data Protection Act 2023 gives a Data Principal four rights and a
      // platform is expected to say what they are and how to use them — a
      // policy that mentions only the one right we happened to build is not a
      // rights section, it is a feature list.
      { kind: "heading", level: 2, text: "Your rights over your data" },
      {
        kind: "paragraph",
        text: "Under India's Digital Personal Data Protection Act, 2023 you have rights over the personal data we hold about you. You can use any of them by writing to the contact below; we will not ask you to explain why.",
      },
      {
        kind: "list",
        items: [
          {
            text: "Know what we hold. A summary of your personal data, what we do with it, and who else we have shared it with.",
          },
          {
            text: "Correct it. Have anything inaccurate corrected, anything incomplete completed, and anything out of date updated.",
          },
          {
            text: "Erase it. Have your personal data deleted where we are not required to keep it. Financial ledgers are immutable and stay as a record; where that applies we anonymize your identifiers rather than destroy the entry.",
          },
          {
            text: "Nominate someone. Name a person to exercise these rights on your behalf if you die or become unable to.",
          },
          {
            text: "Complain. Raise a grievance with us first, and take it to the Data Protection Board of India if we have not resolved it.",
          },
        ],
      },
      {
        kind: "paragraph",
        text: "We answer a rights request within thirty days. If we need longer, or we cannot do what you asked, we tell you why within that time rather than letting it lapse in silence.",
      },
      { kind: "heading", level: 2, text: "Contact" },
      {
        kind: "paragraph",
        text: "Questions about your data, a rights request, or a complaint about how we have handled either — email {0}. If you are not satisfied with our answer, our grievance process and the Grievance Officer's details are in the Grievance Redressal document, and you may escalate to the Data Protection Board of India.",
        links: [{ text: "privacy@desiauction.in", href: "mailto:privacy@desiauction.in" }],
      },
      { kind: "heading", level: 2, text: "Who we are" },
      ...identityBlocks(),
    ],
  },
  {
    slug: "refunds",
    title: "Refund Policy",
    summary: "When a tournament pass is refundable — simple and public.",
    effective: "16 Jul 2026",
    versions: [BETA_DRAFT],
    blocks: [
      DRAFT_NOTICE,
      {
        kind: "callout",
        tone: "info",
        text: "During beta, everything is free, so there is nothing to refund. This policy governs paid passes once they launch.",
      },
      { kind: "heading", level: 2, text: "Full refund until your auction goes live" },
      {
        kind: "paragraph",
        text: "You buy a pass per tournament. You can request a full refund at any time up until your auction goes live. Once the auction goes live, the pass is consumed and is not refundable — you have used the thing you paid for.",
      },
      { kind: "heading", level: 2, text: "Platform-fault abandonment" },
      {
        kind: "paragraph",
        text: "If an auction has to be abandoned because of a fault on our side, we refund the pass — always, regardless of timing.",
      },
      { kind: "heading", level: 2, text: "Your data is never held hostage" },
      {
        kind: "paragraph",
        // "readable and exportable" promised a general exporter that no screen
        // reaches (grep: exportRun / requestExport / buildExportArtifact /
        // ExportKind have zero non-test hits in apps/web/src). What downloads
        // today is the squad CSV and the fixtures CSV. The load-bearing promise
        // — we do not withhold your data over money — is unchanged and true.
        text: "Whatever happens with a pass, your records stay readable, and squads and fixtures download as CSV. We never withhold your data to pressure a payment.",
      },
    ],
  },
  {
    slug: "code-of-conduct",
    title: "Code of Conduct",
    summary: "How we expect everyone on the platform to behave.",
    effective: "16 Jul 2026",
    versions: [BETA_DRAFT],
    blocks: [
      DRAFT_NOTICE,
      {
        kind: "paragraph",
        text: "DesiAuction hosts community tournaments. Auction night should feel like an occasion for everyone in the room. We ask everyone to keep it that way.",
      },
      { kind: "heading", level: 2, text: "We expect" },
      {
        kind: "list",
        items: [
          {
            text: "Respect for every player, owner, organizer and spectator, on and off the platform.",
          },
          {
            text: "Honest conduct: real registrations, genuine bids, and money recorded truthfully.",
          },
          { text: "Care with the data and access you are trusted with." },
        ],
      },
      { kind: "heading", level: 2, text: "We do not tolerate" },
      {
        kind: "list",
        items: [
          { text: "Harassment, discrimination, or abuse of any participant." },
          {
            text: "Attempts to rig an auction, falsify records, or access what you have not been granted.",
          },
          { text: "Using the platform for anything other than genuine tournaments." },
        ],
      },
      { kind: "heading", level: 2, text: "Reporting" },
      {
        kind: "paragraph",
        text: "If someone crosses these lines, tell us at conduct@desiauction.in. We take reports seriously and act on them.",
      },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    summary: "The small amount of storage we use, and what it's for.",
    effective: "16 Jul 2026",
    versions: [BETA_DRAFT],
    blocks: [
      DRAFT_NOTICE,
      {
        kind: "paragraph",
        text: "DesiAuction uses browser storage sparingly, and only to make the product work — not to track you across the web.",
      },
      { kind: "heading", level: 2, text: "What we use" },
      {
        kind: "definitions",
        items: [
          {
            term: "Session cookie",
            def: "Keeps you signed in after you enter your code. Without it, you would have to sign in on every page.",
          },
          {
            term: "Local preferences",
            def: "Small bits of on-device memory — such as when you last visited your inbox — so the product can show you what's new. These never leave your device.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "What we don't use" },
      {
        kind: "paragraph",
        text: "No advertising cookies, no cross-site trackers, no third-party marketing pixels. We do not sell or share browsing data.",
      },
    ],
  },
  {
    slug: "data-retention",
    title: "Data Retention",
    summary: "How long we keep things, and what happens on deletion.",
    effective: "16 Jul 2026",
    versions: [BETA_DRAFT],
    blocks: [
      DRAFT_NOTICE,
      { kind: "heading", level: 2, text: "Immutable records" },
      {
        kind: "paragraph",
        text: "Auction ledgers and financial records are immutable by design and retained as a permanent record of what happened. This is what makes an auction disputable-free and the books trustworthy — the record cannot be quietly changed or erased.",
      },
      { kind: "heading", level: 2, text: "Account deletion" },
      {
        kind: "paragraph",
        text: "You may request deletion of your account. Where your data appears only in your own profile, we delete it. Where it appears in a shared, immutable record — an auction you bid in, a receipt issued to you — we anonymize your personal identifiers rather than destroy the record, so the tournament's history stays intact for everyone else in it.",
      },
      { kind: "heading", level: 2, text: "How to ask" },
      {
        kind: "paragraph",
        text: "Email privacy@desiauction.in from the number on your account, or from an address we can verify against it.",
      },
    ],
  },
  {
    slug: "disclaimer",
    title: "Disclaimer",
    summary: "The limits of what the platform is and does.",
    effective: "16 Jul 2026",
    versions: [BETA_DRAFT],
    blocks: [
      DRAFT_NOTICE,
      { kind: "heading", level: 2, text: "We record; we do not run your tournament" },
      {
        kind: "paragraph",
        text: "DesiAuction is record-keeping and coordination software. Organizers run their own tournaments and handle their own money. We are not a party to the transactions between organizers, owners and players, and we are not a payment processor or financial institution.",
      },
      { kind: "heading", level: 2, text: "No professional advice" },
      {
        kind: "paragraph",
        text: "Nothing in the product or its documents — including exports and tax-related documents — is legal, financial, or tax advice. Consult your own accountant or advisor for your obligations.",
      },
      { kind: "heading", level: 2, text: "Beta" },
      {
        kind: "paragraph",
        text: "During beta, the service is provided as-is. We work hard to keep it reliable, but we do not warrant uninterrupted or error-free operation.",
      },
    ],
  },
  {
    /*
     * REQUIRED, AND ABSENT UNTIL NOW.
     *
     * IT (Intermediary Guidelines) Rules 2021 Rule 3(2) requires a platform to
     * publish the name and contact of a Grievance Officer, the mechanism for
     * making a complaint, an acknowledgement within 24 hours and a resolution
     * within 15 days. The Consumer Protection (E-Commerce) Rules 2020 ask for
     * the same officer plus the operator's legal name and address.
     *
     * The timelines and the mechanism are OURS to state and are stated here.
     * The officer's name and the registered address are founder-held facts this
     * repository cannot invent — `identityBlocks()` renders them when they are
     * set and says plainly that they are not when they are not, and
     * `preflight:production` refuses a deploy in the meantime.
     */
    slug: "grievances",
    title: "Grievance Redressal",
    summary: "How to complain, who handles it, and how long we take.",
    effective: "23 Aug 2026",
    versions: [BETA_DRAFT],
    blocks: [
      DRAFT_NOTICE,
      {
        kind: "paragraph",
        text: "If something about DesiAuction has gone wrong for you — your data, a payment, another person's conduct, a decision an organizer made using the platform, or anything we have done — this is how to raise it and what we will do about it.",
      },
      { kind: "heading", level: 2, text: "How to raise a grievance" },
      {
        kind: "paragraph",
        text: "Write to {0} with GRIEVANCE in the subject line. Tell us what happened, when, and which tournament it concerns — the season name is usually enough for us to find everything else. If it concerns your personal data specifically, {1} reaches the same people and keeps it in one thread.",
        links: [
          { text: "support@desiauction.in", href: "mailto:support@desiauction.in" },
          { text: "privacy@desiauction.in", href: "mailto:privacy@desiauction.in" },
        ],
      },
      { kind: "heading", level: 2, text: "What we commit to" },
      {
        kind: "list",
        items: [
          {
            text: "We acknowledge your complaint within 24 hours of receiving it, with a reference you can quote.",
          },
          {
            text: "We resolve it within 15 days, and tell you what we did. If we cannot, we tell you why and what happens next — within the same 15 days, not after them.",
          },
          {
            text: "A request to take down content about you, where the law requires it, is acted on within 72 hours.",
          },
          {
            text: "We keep a record of every grievance and its outcome. Nothing is closed by going quiet.",
          },
        ],
      },
      { kind: "heading", level: 2, text: "What we cannot resolve" },
      {
        kind: "paragraph",
        text: "We record what happens on the platform; we do not run your tournament. A dispute about a bid your own auctioneer accepted, a payment between you and your organizer, or a selection decision, belongs with the people who made it — and the ledger will show you exactly what was recorded, which is usually what the argument needed. We will help you read it. We will not change it: nothing on the ledger is edited after the fact, by anyone, including us.",
      },
      { kind: "heading", level: 2, text: "If we have not resolved it" },
      {
        kind: "paragraph",
        text: "A complaint about your personal data that we have not resolved to your satisfaction can be taken to the Data Protection Board of India, under the Digital Personal Data Protection Act, 2023. A consumer complaint can be taken to the National Consumer Helpline or the consumer commission with jurisdiction over you. Raising it with us first is not a condition of either, but it is usually faster.",
      },
      { kind: "heading", level: 2, text: "Grievance Officer" },
      ...identityBlocks(),
    ],
  },
  {
    slug: "competition-terms",
    title: "Season Participation Terms",
    summary: "The terms for taking part in a season run on DesiAuction.",
    effective: "16 Jul 2026",
    versions: [BETA_DRAFT],
    blocks: [
      DRAFT_NOTICE,
      { kind: "heading", level: 2, text: "Between you and your organizer" },
      {
        kind: "paragraph",
        text: "When you register for or take part in a season, your agreement about eligibility, fees, dues, rules and prizes is with that season's organizer — not with DesiAuction. The organizer sets those terms; the platform records what happens.",
      },
      { kind: "heading", level: 2, text: "What you agree to" },
      {
        kind: "list",
        items: [
          { text: "Your registration details are accurate and yours." },
          {
            text: "Bids you place as an owner are binding commitments to pay the amounts you win, per your organizer's terms.",
          },
          { text: "The auction record is the authoritative account of the night." },
        ],
      },
      { kind: "heading", level: 2, text: "Money" },
      {
        kind: "paragraph",
        text: "Payments and refunds for a season — purses, dues, entry fees — are collected and settled by your organizer, through whatever channels they use (cash, UPI, bank transfer). DesiAuction records these but does not hold or move your money.",
      },
      { kind: "heading", level: 2, text: "Questions" },
      {
        kind: "paragraph",
        text: "For anything about a specific season — eligibility, fees, a dispute — contact that season's organizer directly. For platform issues, contact us.",
      },
    ],
  },
];

export function legalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);
}
