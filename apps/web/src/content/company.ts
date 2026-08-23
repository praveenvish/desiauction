/**
 * THE LEGAL IDENTITY OF THE OPERATOR.
 *
 * The Legal Centre ships eight well-drafted documents and never says WHO is
 * offering them. That is the one gap in this product's public content that is
 * not a matter of taste: an India-facing platform that processes personal data
 * and takes payments is required to publish its identity, a grievance officer,
 * and how to reach both.
 *
 *   · IT (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021,
 *     Rule 3(2) — publish the NAME and CONTACT of a Grievance Officer and the
 *     complaint mechanism; acknowledge within 24 hours, resolve within 15 days.
 *   · Digital Personal Data Protection Act 2023, s.13 — publish the contact of
 *     a Data Protection Officer, or of a person able to answer a Data
 *     Principal's questions about processing.
 *   · Consumer Protection (E-Commerce) Rules 2020, Rule 4(3) — display the
 *     legal name, the principal geographic address, customer-care details, and
 *     the grievance officer's name, contact and redressal time-frame.
 *
 * NONE of it can be derived from this repository, and inventing a company name
 * or an address would be the worst possible line to fabricate — so every field
 * below is `null` and the surfaces render an explicit "not yet published"
 * rather than a blank or a guess.
 *
 * `pnpm preflight:production` FAILS while they are null. Running a beta on a
 * laptop without them is fine; serving real people is not.
 */

export interface LegalIdentity {
  /** Registered legal name, exactly as incorporated. */
  readonly legalName: string | null;
  /** The trading name, if it differs. Null means the legal name is used. */
  readonly tradingName: string | null;
  /** CIN / LLPIN / registration number, whichever applies to the entity. */
  readonly registrationNumber: string | null;
  /** Principal geographic address — a real postal address, not a PO box. */
  readonly registeredAddress: string | null;
  /** GSTIN of the operator, if registered. Distinct from an organizer's own. */
  readonly gstin: string | null;
  /** The named Grievance Officer. A role title alone does not satisfy Rule 3(2). */
  readonly grievanceOfficerName: string | null;
  readonly grievanceOfficerEmail: string | null;
  /** A phone reachable in business hours; the e-commerce rules expect one. */
  readonly grievanceOfficerPhone: string | null;
  /** Whoever answers a Data Principal about processing (DPDP s.13). */
  readonly dataProtectionContactName: string | null;
  readonly dataProtectionContactEmail: string;
}

export const LEGAL_IDENTITY: LegalIdentity = {
  // TODO(founder): the registered name on the certificate of incorporation.
  legalName: null,
  tradingName: "DesiAuction",
  // TODO(founder): CIN for a company, LLPIN for an LLP, or the registration
  // number of whatever entity actually signs these terms.
  registrationNumber: null,
  // TODO(founder): the principal place of business. The Terms already put
  // disputes before the courts of Mumbai, Maharashtra — the address should be
  // consistent with that or the jurisdiction clause invites an argument.
  registeredAddress: null,
  // TODO(founder): DesiAuction's OWN GSTIN, if registered. The only GSTIN
  // anywhere in the platform today belongs to the ORGANIZER, on
  // `finops_profiles`, and is a different thing entirely.
  gstin: null,
  // TODO(founder): a named person. "The support team" is not a Grievance
  // Officer under Rule 3(2); the rule asks for a name.
  grievanceOfficerName: null,
  grievanceOfficerEmail: null,
  // TODO(founder): a contact number answerable in business hours.
  grievanceOfficerPhone: null,
  // TODO(founder): may be the same person as the Grievance Officer for an
  // organisation this size — but it has to be somebody, and named.
  dataProtectionContactName: null,
  // The one contact that IS live and already published across the legal centre.
  dataProtectionContactEmail: "privacy@desiauction.in",
};

/** The fields a production deployment may not go live without. */
export const REQUIRED_FOR_PRODUCTION = [
  "legalName",
  "registeredAddress",
  "grievanceOfficerName",
  "grievanceOfficerEmail",
] as const satisfies readonly (keyof LegalIdentity)[];

/** Which required fields are still unset. Empty means the identity is publishable. */
export function missingLegalIdentity(identity: LegalIdentity = LEGAL_IDENTITY): readonly string[] {
  return REQUIRED_FOR_PRODUCTION.filter((field) => {
    const value = identity[field];
    return value === null || value.trim() === "";
  });
}

/** True when every legally required field is published. */
export function legalIdentityPublished(identity: LegalIdentity = LEGAL_IDENTITY): boolean {
  return missingLegalIdentity(identity).length === 0;
}
