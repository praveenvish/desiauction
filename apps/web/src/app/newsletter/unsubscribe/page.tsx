import type { Metadata } from "next";

import { env } from "../../../env";
import { UnsubscribeForm } from "./unsubscribe-form";
import "../../content.css";
import "../../marketing.css";

export const metadata: Metadata = {
  title: "Unsubscribe · DesiAuction",
  description: "Take your address off the DesiAuction product-news list.",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/newsletter/unsubscribe` },
  // A utility page with nothing to find; it should not compete in search.
  robots: { index: false, follow: true },
};

/** Public and sign-in-free: the list asked nobody to sign in, so leaving it can't either. */
export default function UnsubscribePage() {
  return (
    <main className="content-page mk">
      <h1>Unsubscribe</h1>
      <p className="content-lead">
        Enter the address you signed up with and we will remove it from the product-news list.
        Addresses we still hold are deleted automatically twenty-four months after they were added.
      </p>
      <UnsubscribeForm />
    </main>
  );
}
