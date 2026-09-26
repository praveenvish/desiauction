/**
 * WHO OPERATES DESIAUCTION — the operator's published identity.
 *
 * An India-facing platform that processes personal data and takes payments
 * must publish who it is and how to reach its Grievance Officer: Consumer
 * Protection (E-Commerce) Rules 2020 r.4(3) (legal name, principal address,
 * grievance officer), IT Rules 2021 r.3(2) (grievance officer name and
 * contact), Companies Act s.12(3)(c) (the CIN). See `content/company.ts`.
 *
 * It used to be 9px fine print at the bottom of every footer. It now lives as
 * a legible card on the pages a visitor goes to in order to check who they are
 * dealing with — /legal, /support and /legal/grievances — and every page's
 * footer bottom bar links to Grievances, so it stays one click away.
 *
 * Renders NOTHING while the identity is unpublished: never a placeholder, and
 * never a guess.
 */
import { IconShieldCheck } from "@desiauction/ui";
import Link from "next/link";

import { LEGAL_IDENTITY, legalIdentityPublished } from "../../content/company";

export function OperatorIdentityCard({
  headingId = "operator-identity",
  title = "Who operates DesiAuction",
  grievanceLink = true,
  compact = false,
}: {
  headingId?: string;
  title?: string;
  /** Off on /legal/grievances itself, where the link would point at the page. */
  grievanceLink?: boolean;
  /**
   * /support: only who to complain to, and a link to the full identity on
   * /legal — the whole card there repeated /legal word for word.
   */
  compact?: boolean;
}) {
  if (!legalIdentityPublished()) {
    return null;
  }
  const id = LEGAL_IDENTITY;
  return (
    <section className="pk-operator" aria-labelledby={headingId} data-testid="operator-identity">
      <div className="pk-operator-head">
        <span className="pk-operator-tile" aria-hidden>
          <IconShieldCheck size={24} weight="duotone" />
        </span>
        <div>
          <h2 className="pk-operator-title" id={headingId}>
            {title}
          </h2>
          <p className="pk-operator-lede">
            {id.tradingName ?? "DesiAuction"} is a product of {id.legalName}.
          </p>
        </div>
      </div>
      <dl className="pk-operator-facts">
        {compact ? null : (
          <div>
            <dt>Legal name</dt>
            <dd>{id.legalName}</dd>
          </div>
        )}
        {!compact && id.registrationNumber !== null ? (
          <div>
            <dt>CIN</dt>
            <dd className="pk-operator-mono">{id.registrationNumber}</dd>
          </div>
        ) : null}
        {!compact && id.gstin !== null ? (
          <div>
            <dt>GSTIN</dt>
            <dd className="pk-operator-mono">{id.gstin}</dd>
          </div>
        ) : null}
        {!compact && id.registeredAddress !== null ? (
          <div>
            <dt>Registered office</dt>
            <dd>{id.registeredAddress}</dd>
          </div>
        ) : null}
        {id.grievanceOfficerName !== null ? (
          <div>
            <dt>Grievance Officer</dt>
            <dd>
              {id.grievanceOfficerName}
              {id.grievanceOfficerEmail !== null ? (
                <>
                  {compact ? <br /> : " · "}
                  <a href={`mailto:${id.grievanceOfficerEmail}`} data-private>
                    {id.grievanceOfficerEmail}
                  </a>
                </>
              ) : null}
              {id.grievanceOfficerPhone !== null ? (
                <>
                  {compact ? <br /> : " · "}
                  <a href={`tel:${id.grievanceOfficerPhone.replace(/\s+/g, "")}`} data-private>
                    {id.grievanceOfficerPhone}
                  </a>
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Privacy contact</dt>
          <dd>
            <a href={`mailto:${id.dataProtectionContactEmail}`} data-private>
              {id.dataProtectionContactEmail}
            </a>
          </dd>
        </div>
      </dl>
      <p className="pk-operator-foot">
        Complaints are acknowledged within 24 hours and resolved within 15 days.
        {compact ? (
          <>
            {" "}
            <Link href="/legal">Full operator details</Link>
          </>
        ) : null}
        {grievanceLink && !compact ? (
          <>
            {" "}
            <Link href="/legal/grievances">How grievance redressal works</Link>
          </>
        ) : null}
      </p>
    </section>
  );
}
