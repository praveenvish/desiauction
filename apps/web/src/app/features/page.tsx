import { ButtonLink, SoldStamp } from "@desiauction/ui";
import { HashTabs } from "../../components/marketing/hash-tabs";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { env } from "../../env";
import { FEATURE_GROUPS, LANDING } from "../../content/marketing";
import {
  IconCheck,
  IconLedger,
  IconRefresh,
  IconShieldCheck,
} from "../../components/marketing/icons";
import { slugify } from "../../lib/slug";
import "../content.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Features · DesiAuction",
  description: "Everything DesiAuction does — registration, the live auction, and the money.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/features` },
};

const FOUNDATION_ICONS = [IconShieldCheck, IconLedger, IconRefresh] as const;

/**
 * Product vignettes: each feature group is SHOWN as the surface it describes,
 * built from the same tokens the product renders with. Decorative (aria-hidden)
 * — the adjacent checklist is the accessible content — and truthful: every
 * frame depicts a surface the certified platform actually has.
 */
const VIGNETTES: Record<string, ReactNode> = {
  Registration: (
    <div className="mk-vignette" aria-hidden="true">
      <div className="mk-vignette-bar">
        <i />
        <i />
        <i />
        <span>Registration desk</span>
      </div>
      <div className="mk-vignette-body">
        <div className="mk-vrow">
          <span>
            <strong>K. Patel</strong> · All-rounder
          </span>
          <span className="mk-vpill mk-vpill--ok">Approved</span>
        </div>
        <div className="mk-vrow">
          <span>
            <strong>S. Nair</strong> · Bowler
          </span>
          <span className="mk-vpill mk-vpill--wait">Waitlist</span>
        </div>
        <div className="mk-vrow">
          <span>
            <strong>R. Iyer</strong> · Wicket-keeper
          </span>
          <span className="mk-vpill mk-vpill--ok">Approved</span>
        </div>
        <div className="mk-vbar">
          <i style={{ width: "72%" }} />
        </div>
      </div>
    </div>
  ),
  "The live auction": (
    <div className="mk-vignette" aria-hidden="true">
      <div className="mk-vignette-bar">
        <i />
        <i />
        <i />
        <span>Live room · Lot 23</span>
      </div>
      <div className="mk-vignette-body">
        {/* The same stamp the live room lands (theatre pass) — the vignette's
            "SOLD" used to be a span whose class no longer exists. */}
        <div className="mk-stage-bid mk-stage-bid--flat">
          <span>
            <span className="mk-stage-bid-label">Winning bid</span>
            <span className="mk-stage-amount">₹85,000</span>
          </span>
          <SoldStamp size="md" hammer={false} className="mk-stage-stamp" />
        </div>
        <div className="mk-vrow">
          <span>
            <strong>Hawks</strong> called
          </span>
          <span className="mk-vmeta">₹80,000</span>
        </div>
        <div className="mk-vrow">
          <span>
            <strong>Strikers</strong> called
          </span>
          <span className="mk-vmeta">₹75,000</span>
        </div>
      </div>
    </div>
  ),
  "Money & records": (
    <div className="mk-vignette" aria-hidden="true">
      <div className="mk-vignette-bar">
        <i />
        <i />
        <i />
        <span>Settlement · receipts</span>
      </div>
      <div className="mk-vignette-body">
        <div className="mk-vrow">
          <span>
            <strong>Receipt R-0042</strong> · UPI
          </span>
          <span className="mk-vpill mk-vpill--ok">Issued</span>
        </div>
        <div className="mk-vrow">
          <span>
            <strong>Collection</strong> · ₹8,500 against dues
          </span>
          <span className="mk-vpill mk-vpill--info">Recorded</span>
        </div>
        {/* Was "Tally export · ledger-verified · Ready" — an illustration of a
            feature that is reachable from no screen, rendered beside four that
            ship. The vignette now shows the verification the workspace really
            performs: an issued document re-derived and matched to its seal. */}
        <div className="mk-vrow">
          <span>
            <strong>Register check</strong> · R-0042 re-derived
          </span>
          <span className="mk-vpill mk-vpill--ok">Matches seal</span>
        </div>
      </div>
    </div>
  ),
  "Trust & governance": (
    <div className="mk-vignette" aria-hidden="true">
      <div className="mk-vignette-bar">
        <i />
        <i />
        <i />
        <span>Audit trail</span>
      </div>
      <div className="mk-vignette-body">
        <div className="mk-vrow">
          <span>
            <strong>settlement.collect</strong> granted
          </span>
          <span className="mk-vpill mk-vpill--info">Grant</span>
        </div>
        <div className="mk-vrow">
          <span>
            <strong>Ledger entry 1042</strong> · append-only
          </span>
          <span className="mk-vpill mk-vpill--ok">Sealed</span>
        </div>
        <div className="mk-vrow">
          <span>
            <strong>Sign-in</strong> · passkey
          </span>
          <span className="mk-vpill mk-vpill--ok">Verified</span>
        </div>
      </div>
    </div>
  ),
};

/**
 * PX-10 — the feature overview / product capabilities page (CTO §3). A durable
 * URL for the capability list the landing anchors at #features. Every item is a
 * capability the certified platform actually has. Public, no auth. The
 * presentation is a showcase: alternating capability rows, each shown as the
 * surface it describes.
 */
export default function FeaturesPage() {
  return (
    <main className="mk">
      <section className="mk-hero mk-hero--page" data-theme="floodlight">
        <div className="mk-container mk-center">
          <div className="mk-hero-copy">
            <p className="mk-kicker">The full platform</p>
            <h1 className="mk-h1 mk-h1--page">Everything a tournament needs</h1>
            <p className="mk-lead">{LANDING.hero.sub}</p>
          </div>
        </div>
      </section>

      {/* THE FOUR GROUPS AS TABS. They are exactly parallel — a title, a
          checklist, a vignette of the surface — and stacked they were a
          3,100px scroll through four identical rows. Behind a segmented
          control each is one screen, the strip reads as the platform's table
          of contents, and the panel is in the address bar (#the-live-auction)
          so it can be pointed at. Every panel stays in the DOM. */}
      <section className="mk-band mk-band--panel" aria-label="What the platform does">
        <div className="mk-container">
          <div className="mk-segmented mk-segmented--wide">
            <HashTabs
              label="Feature groups"
              tabs={FEATURE_GROUPS.map((group) => {
                const id = slugify(group.title);
                return {
                  id,
                  label: group.title,
                  content: (
                    <div className="mk-show mk-show--flush">
                      <div>
                        <h2 id={`feature-${id}`}>{group.title}</h2>
                        <ul className="mk-checklist">
                          {group.features.map((feature) => (
                            <li key={feature}>
                              <IconCheck />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="mk-show-visual">{VIGNETTES[group.title]}</div>
                    </div>
                  ),
                };
              })}
            />
          </div>
        </div>
      </section>

      <section
        className="mk-band mk-band--dark"
        data-theme="floodlight"
        aria-labelledby="features-foundation"
      >
        <div className="mk-container">
          <div className="mk-band-head mk-band-head--center mk-center">
            <p className="mk-kicker">Why you can trust it</p>
            <h2 id="features-foundation" className="mk-h2">
              {LANDING.foundation.h2}
            </h2>
          </div>
          <div className="mk-cards">
            {LANDING.foundation.cards.map((card, index) => {
              const Icon = FOUNDATION_ICONS[index] ?? IconCheck;
              return (
                <div key={card.title} className="mk-card">
                  <span className="mk-icon-tile">
                    <Icon />
                  </span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </div>
              );
            })}
          </div>
          <div className="mk-cta-actions mk-cta-actions--closing">
            <ButtonLink href="/login" variant="primary" size="lg">
              Start your auction
            </ButtonLink>
            <ButtonLink href="/pricing" variant="secondary" size="lg">
              See pricing
            </ButtonLink>
          </div>
        </div>
      </section>
    </main>
  );
}
