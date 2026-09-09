/**
 * REGISTRATION ELIGIBILITY — one evaluator, structured reasons (PI-1).
 *
 * The house already answers "may this happen?" with reason lists in four
 * places (auction readiness, publish blockers, the bid gauntlet, competition
 * transitions); registration eligibility now speaks the same way. Frontend
 * DISPLAYS the verdict, backend DECIDES with it — both call this function,
 * so a rule cannot drift between the form and the writer.
 *
 * Gender rules live HERE AND NOWHERE ELSE. A guardrail test greps the source
 * tree for gender comparisons outside this module — scattering
 * `if gender === …` through the app is the exact anti-pattern this engine
 * exists to prevent.
 *
 * What is deliberately NOT here:
 *   · duplicates — the DB unique index + withdrawn-reinstatement own that
 *     transactionally; a precheck would just race it;
 *   · publication consent — that is consent CAPTURE, not eligibility;
 *   · approval — invariant 5: a human always decides who enters the pool.
 *
 * Pure: no IO, no ambient clock — `now` is injected (house rule 2.1).
 */

import { isMinor, type Gender } from "./player-profile";
import { parseRoleIn, sportPackFor } from "./sports";

export const ENTRY_CATEGORIES = ["open", "men", "women", "mixed"] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

export function isEntryCategory(value: string): value is EntryCategory {
  return (ENTRY_CATEGORIES as readonly string[]).includes(value);
}

const ENTRY_CATEGORY_LABELS: Record<EntryCategory, string> = {
  open: "Open",
  men: "Men's",
  women: "Women's",
  mixed: "Mixed",
};

/** Public-surface terminology ("Women's", never a raw enum on air). */
export function entryCategoryLabel(category: EntryCategory): string {
  return ENTRY_CATEGORY_LABELS[category];
}

export type EligibilityReason =
  /** Self-serve only: the season is not taking registrations right now. */
  | "intake_closed"
  /** The role is not one of the four the platform knows. */
  | "invalid_role"
  /** DPDP §9: a registrant under 18 needs a named guardian's consent. */
  | "minor_missing_guardian"
  /**
   * The person's own declared gender is DIRECTLY contrary to the season's
   * category (female ↔ men's, male ↔ women's). Only that blocks, and only on
   * the self-serve path: everything less certain is an advisory for the human
   * gate, because a platform that adjudicates anyone's gender has overstepped
   * what it can know.
   */
  | "category_mismatch";

export type EligibilityAdvisory =
  /** Gendered category, but the profile has no usable answer — the organizer
   *  sees the flag at triage; the person is told how to confirm. */
  | "category_unconfirmed"
  /** Organizer channel only: the mismatch above, downgraded — invariant 5,
   *  the organizer is the gate and may know better. Audited, never silent. */
  | "category_mismatch";

export interface RegistrationEligibilityInput {
  /** The competition's lifecycle status (`registration_open` admits). */
  competitionStatus: string;
  entryCategory: EntryCategory;
  /** Any spelling the SEASON'S SPORT accepts. */
  role: string;
  /**
   * The season's sport key, which decides what a role is.
   *
   * REQUIRED, deliberately. This gate judged every role against cricket, so a
   * football player picking "Midfielder" on a form the football pack itself had
   * drawn was refused `invalid_role` — the sport packs shipped and no player
   * could enter a season of three of the four. An optional field with a cricket
   * default would have let the next caller reintroduce that in silence, so the
   * compiler asks everybody instead.
   */
  sport: string;
  /** From the person-level profile; null = never asked. */
  gender: Gender | null;
  /** The DOB being registered WITH (the season's snapshot value). */
  dateOfBirth: string | null;
  guardianConsent: boolean;
  guardianName: string;
  /**
   * `self` — the person registering themselves: every rule enforces.
   * `organizer` — add-by-phone / import: intake and minors stay the
   * organizer's judgment (the import deliberately works on a closed season,
   * DA-35), and category demotes to advisory.
   */
  channel: "self" | "organizer";
  now: Date;
}

export interface EligibilityVerdict {
  eligible: boolean;
  reasons: EligibilityReason[];
  advisories: EligibilityAdvisory[];
}

function categoryVerdict(
  category: EntryCategory,
  gender: Gender | null,
): "ok" | "mismatch" | "unconfirmed" {
  if (category === "open" || category === "mixed") {
    return "ok";
  }
  if (gender === "male") {
    return category === "men" ? "ok" : "mismatch";
  }
  if (gender === "female") {
    return category === "women" ? "ok" : "mismatch";
  }
  // null (never asked), unspecified (declined), non_binary, self_described:
  // not the platform's call — flag for the human gate, admit the person.
  return "unconfirmed";
}

export function evaluateRegistration(input: RegistrationEligibilityInput): EligibilityVerdict {
  const reasons: EligibilityReason[] = [];
  const advisories: EligibilityAdvisory[] = [];

  if (input.channel === "self" && input.competitionStatus !== "registration_open") {
    reasons.push("intake_closed");
  }

  /*
   * EMPTY AND WRONG ARE DIFFERENT ANSWERS.
   *
   * A role the sport does not have is always wrong. An ABSENT role is wrong
   * only where the sport says every player has one — `roles.required` is a
   * per-pack fact, and a sport with no meaningful playing position would have
   * to invent one to satisfy a blanket rule.
   *
   * Written this way rather than `required && invalid` because that form stops
   * checking ENTIRELY for an optional-role sport, and would wave through any
   * string at all. The three gates that judge a role — this one, the
   * registration writer and `validateNewPlayer` — say it the same way on
   * purpose: three gates disagreeing about one question is how they all came
   * to be asking cricket.
   */
  const pack = sportPackFor(input.sport);
  const declared = input.role.trim();
  if (declared === "" ? pack.roles.required : parseRoleIn(pack, declared) === null) {
    reasons.push("invalid_role");
  }

  if (
    input.channel === "self" &&
    isMinor(input.dateOfBirth, input.now) &&
    !(input.guardianConsent && input.guardianName.trim() !== "")
  ) {
    reasons.push("minor_missing_guardian");
  }

  const category = categoryVerdict(input.entryCategory, input.gender);
  if (category === "mismatch") {
    if (input.channel === "self") {
      reasons.push("category_mismatch");
    } else {
      advisories.push("category_mismatch");
    }
  } else if (category === "unconfirmed") {
    advisories.push("category_unconfirmed");
  }

  return { eligible: reasons.length === 0, reasons, advisories };
}
