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

/*
 * SOURCE OF THE THREE REGISTRY FIELDS BELOW, AND WHAT STILL HAS TO BE CHECKED.
 *
 * Name, CIN and registered office were read from the MCA record as republished
 * by Tofler (2026-08-26). That is an AGGREGATOR, not the register: the
 * certificate of incorporation and the MCA master data are authoritative, and a
 * registered office in particular changes without the aggregators noticing.
 * Confirm all three against the certificate before this is served to real
 * people — publishing a stale principal address is itself the compliance
 * failure this file exists to prevent.
 *
 * AND THE CONTACTS HAVE TO ANSWER. Publishing a Grievance Officer starts a
 * clock: Rule 3(2) requires acknowledgement within 24 hours and resolution
 * within 15 days, and DPDP s.13 expects the privacy contact to answer a Data
 * Principal at all.
 *
 * `desiauction.in` IS registered — and, checked 2026-08-26, it is parked and
 * cannot receive mail:
 *
 *     NS  ns1.dns-parking.com / ns2.dns-parking.com
 *     A   2.57.91.91
 *     MX  (none)
 *
 * With no MX record every address on this domain bounces, so both contacts
 * below are correct and undeliverable. That is the worse failure of the two: an
 * unpublished address is a gap, a published one that bounces is a statutory
 * duty the company is visibly not performing. Add MX (and SPF/DKIM/DMARC, or
 * the mail that does get through lands in spam) BEFORE this identity is served
 * to real people — it is now the only thing standing between these fields and
 * being honest.
 */
export const LEGAL_IDENTITY: LegalIdentity = {
  // Eventztree Private Limited, incorporated 05 July 2022, status Active.
  // TODO(founder): confirm the capitalisation against the certificate — the
  // registry renders it "Eventztree", not "EventzTree".
  legalName: "Eventztree Private Limited",
  tradingName: "DesiAuction",
  // U92419RJ2022PTC082398 — RJ = Rajasthan, PTC = private limited company.
  // A private limited company must display this under Companies Act s.12(3)(c).
  registrationNumber: "U92419RJ2022PTC082398",
  // The registered office as filed. The Terms named Mumbai when this company is
  // registered in Jaipur; the forum was moved to Jaipur (founder decision,
  // 2026-08-26) so the jurisdiction clause and the published identity agree.
  // TODO(founder): confirm this is also the PRINCIPAL place of business —
  // Consumer Protection (E-Commerce) Rules 4(3) asks for that, and it is not
  // always the registered office.
  registeredAddress: "P.No. 21 B, Ganesh Vihar, Nirman Nagar, Jaipur, Rajasthan 302019, India",
  // TODO(founder): DesiAuction's OWN GSTIN, if registered. The only GSTIN
  // anywhere in the platform today belongs to the ORGANIZER, on
  // `finops_profiles`, and is a different thing entirely.
  gstin: null,
  // Appointed by the company (2026-08-26); also a director on the MCA record
  // (DIN 09662665). Rule 3(2) wants a NAME, and this is it.
  //
  // Rule 3(2) also attaches obligations to publishing it: complaints
  // acknowledged within 24 hours and resolved within 15 days. The address below
  // therefore has to be a mailbox somebody actually reads — see the note above
  // about `desiauction.in` needing to exist before any of this is served.
  grievanceOfficerName: "Navrangi Vishnoi",
  grievanceOfficerEmail: "navrangi@desiauction.in",
  grievanceOfficerPhone: "+91 97849 84135",
  // The same person as the Grievance Officer, which DPDP s.13 permits — the
  // Act asks for someone able to answer a Data Principal, not for a separate
  // office. Named, which is the part that matters.
  dataProtectionContactName: "Navrangi Vishnoi",
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
