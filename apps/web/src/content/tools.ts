import {
  IMPORT_FIELD_LABELS,
  attributeImportField,
  type AttributeImportField,
  type ImportField,
  type SportPack,
} from "@desiauction/core";

/**
 * THE FREE TOOLS (SEO-1 Phase 4d) — `/tools` and `/tools/[slug]`.
 *
 * Useful without an account, and built on the product's own code rather than
 * a second copy of its rules:
 *
 *   purse-calculator        the auction's own reserve rule (`maxAffordableBid`),
 *                           increment ladders (`DEFAULT_AUCTION_CONFIG`,
 *                           `pointsSlabs`) and config check
 *                           (`validateAuctionConfig`), from @desiauction/core.
 *   registration-form       Google Form questions whose headings the importer
 *                           (`detectMapping`) recognises — a test runs every
 *                           sport's template through the real import.
 *   snake-draft             a pick order. DesiAuction runs auctions, not
 *                           drafts, and the page says so.
 */

export interface ToolFaq {
  readonly question: string;
  readonly answer: string;
}

export interface ToolPage {
  readonly slug: string;
  readonly name: string;
  readonly title: string;
  readonly headline: string;
  /** Meta description: 50–160 characters. */
  readonly description: string;
  readonly lede: string;
  readonly faqs: readonly ToolFaq[];
  readonly updatedOn: string;
}

export const TOOL_PAGES: readonly ToolPage[] = [
  {
    slug: "purse-calculator",
    name: "Purse and base price calculator",
    title: "Auction purse and base price calculator",
    headline: "How big should each team's purse be?",
    description:
      "Free auction purse calculator: check a purse against squad size and base price, see the biggest first bid the reserve rule allows, and the bid increments.",
    lede: "Set the teams, the purse, the squad size and the lowest base price. The calculator uses the same rules the live auction enforces, so what it says here is what the room will allow.",
    faqs: [
      {
        question: "What is the reserve rule?",
        answer:
          "A team must always keep enough to fill its minimum squad at the lowest base price. So a bid is refused if it would leave less than that behind — which is why the biggest first bid is less than the whole purse.",
      },
      {
        question: "How are bid increments decided?",
        answer:
          "A rupee auction steps +₹5,000 up to ₹1 lakh, +₹10,000 up to ₹5 lakh and +₹25,000 above. A points auction's steps scale with the purse, so a 1,000-point purse bids in 5s, 10s and 25s.",
      },
      {
        question: "Can we use points instead of rupees?",
        answer:
          "Yes. Switch the calculator to points to see a points league's numbers, including its own increment steps.",
      },
    ],
    updatedOn: "2026-10-01",
  },
  {
    slug: "registration-form",
    name: "Registration form template",
    title: "Player registration form template",
    headline: "A player registration form that imports cleanly",
    description:
      "Free player registration form template for your tournament: the Google Form questions to ask, per sport, worded so the responses import without fixing.",
    lede: "Most leagues already collect registrations with a Google Form. Ask these questions, worded this way, and the responses import straight into DesiAuction — no renaming columns, no retyping roles.",
    faqs: [
      {
        question: "Why does the wording of each question matter?",
        answer:
          "The importer matches columns by their heading. A question titled as shown here is recognised on its own, so nobody has to map columns by hand.",
      },
      {
        question: "What if our form is already running?",
        answer:
          "You can still import it. Headings that are not recognised can be matched to the right field by hand during the import, and each row is checked before anything is saved.",
      },
      {
        question: "Can players upload a photo?",
        answer:
          "Yes. Add a file-upload question for the photo; the import recognises the Google Drive links it produces and fetches each player's own file.",
      },
    ],
    updatedOn: "2026-10-01",
  },
  {
    slug: "snake-draft",
    name: "Snake draft order",
    title: "Snake draft order generator",
    headline: "Work out a snake draft order",
    description:
      "Free snake draft order generator: enter your teams and rounds to get the pick order, reversing every round, ready to read out or share with owners.",
    lede: "Some leagues pick players in a snake draft instead of an auction: the last team to pick in one round picks first in the next. Enter your teams to get the order.",
    faqs: [
      {
        question: "What is a snake draft?",
        answer:
          "Teams take turns picking one player each. The order reverses every round — 1 to 8, then 8 to 1 — so the team that picks last in a round picks first in the next.",
      },
      {
        question: "Does DesiAuction run drafts?",
        answer:
          "No. DesiAuction runs live auctions, where owners bid for players against a purse. This tool is here for leagues that pick by draft.",
      },
      {
        question: "Draft or auction — which is fairer?",
        answer:
          "A draft spreads picks evenly; an auction lets each owner decide who is worth more. Many leagues use an auction with a purse and a minimum squad so that no team can buy all the stars.",
      },
    ],
    updatedOn: "2026-10-01",
  },
];

export function toolPage(slug: string): ToolPage | undefined {
  return TOOL_PAGES.find((page) => page.slug === slug);
}

/** For a tool's own route, whose entry must exist: a missing one fails the build, not a visitor. */
export function requireToolPage(slug: string): ToolPage {
  const page = toolPage(slug);
  if (page === undefined) throw new Error(`content/tools.ts has no "${slug}" entry`);
  return page;
}

/* ---------------------------------------------------------------------------
 * THE REGISTRATION FORM TEMPLATE, per sport.
 * ------------------------------------------------------------------------- */

export type QuestionKind = "Short answer" | "Multiple choice" | "Date" | "File upload";

export interface TemplateQuestion {
  /** The question's title in the form — the column heading the import reads. */
  readonly heading: string;
  /** The import field the heading is recognised as (a sport's own detail is `attr:<key>`). */
  readonly field: ImportField | AttributeImportField;
  readonly kind: QuestionKind;
  readonly required: boolean;
  /** Choices to offer, for a multiple-choice question. */
  readonly options?: readonly string[];
  readonly note?: string;
}

/**
 * The questions to ask for one sport. Headings are the importer's own column
 * labels (IMPORT_FIELD_LABELS) so they are recognised without mapping; role
 * choices are the pack's role labels, which the importer maps back to roles.
 *
 * Only fields the import reads are listed. Cricket's batting and bowling style
 * are fixed import fields; every other sport's own details (preferred foot,
 * grip, spiking hand…) are read by their headings since the import learned the
 * pack's attributes (#183), titled here with the attribute's own label.
 */
export function registrationTemplate(pack: SportPack): TemplateQuestion[] {
  const cricketStyle = pack.attributes.filter(
    (attribute) => attribute.key === "batting_style" || attribute.key === "bowling_style",
  );
  return [
    { heading: IMPORT_FIELD_LABELS.name, field: "name", kind: "Short answer", required: true },
    {
      heading: IMPORT_FIELD_LABELS.phone,
      field: "phone",
      kind: "Short answer",
      required: true,
      note: "Every player needs one on DesiAuction, and it is never shown on a public page.",
    },
    {
      heading: IMPORT_FIELD_LABELS.role,
      field: "role",
      kind: "Multiple choice",
      required: true,
      options: pack.roles.values.map((role) => role.label),
    },
    ...pack.attributes
      .filter((attribute) => !cricketStyle.includes(attribute))
      .map((attribute) => ({
        heading: attribute.label,
        field: attributeImportField(attribute.key),
        kind: "Multiple choice" as const,
        required: false,
        options: attribute.options.map((option) => option.label),
      })),
    ...cricketStyle.map((attribute) => ({
      heading: IMPORT_FIELD_LABELS[attribute.key as "batting_style" | "bowling_style"],
      field: attribute.key as ImportField,
      kind: "Multiple choice" as const,
      required: false,
      options: attribute.options.map((option) => option.label),
    })),
    {
      heading: IMPORT_FIELD_LABELS.date_of_birth,
      field: "date_of_birth",
      kind: "Date",
      required: false,
      note: "Useful for age-group or junior tournaments.",
    },
    {
      heading: IMPORT_FIELD_LABELS.jersey_name,
      field: "jersey_name",
      kind: "Short answer",
      required: false,
    },
    {
      heading: IMPORT_FIELD_LABELS.jersey_number,
      field: "jersey_number",
      kind: "Short answer",
      required: false,
    },
    {
      heading: IMPORT_FIELD_LABELS.tshirt_size,
      field: "tshirt_size",
      kind: "Multiple choice",
      required: false,
      options: ["XS", "S", "M", "L", "XL", "XXL"],
    },
    {
      heading: IMPORT_FIELD_LABELS.photo_link,
      field: "photo_link",
      kind: "File upload",
      required: false,
      note: "Google Forms stores the upload in Drive; the import fetches each player's own file.",
    },
  ];
}
