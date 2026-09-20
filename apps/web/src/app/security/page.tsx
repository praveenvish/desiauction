import type { Metadata } from "next";

import { env } from "../../env";
import { LANDING } from "../../content/marketing";
import { ContentPage } from "../../components/public/content-page";
import "../content.css";

export const metadata: Metadata = {
  title: "Security · DesiAuction",
  description: "How DesiAuction keeps the auction and the money trustworthy.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/security` },
};

/** Real, certified architecture facts — same content as the removed home
 * page "foundation" section and /features. Public, no auth. */
export default function SecurityPage() {
  return (
    <ContentPage eyebrow="Trust" title="Security" lede={LANDING.foundation.h2}>
      <div className="prose">
        {LANDING.foundation.cards.map((card) => (
          <div key={card.title} className="content-section">
            <h2>{card.title}</h2>
            <p className="prose-p">{card.body}</p>
          </div>
        ))}
        <div className="content-section">
          <h2>Access is deliberate, not default</h2>
          <p className="prose-p">
            Money authority is granted, not inherited from a role — owning an organization doesn't
            hand you the settlement or finance desks. Every grant is auditable, and sign-in is
            phone-first with passkey support, not a password to leak.
          </p>
        </div>
      </div>
    </ContentPage>
  );
}
