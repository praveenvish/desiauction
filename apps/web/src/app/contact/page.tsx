import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { env } from "../../env";

/**
 * /contact is kept as an address, not as a page.
 *
 * It rendered the same support email cards as /support with a thinner frame
 * around them, so a reader who found both had to wonder which one was the real
 * way in. /support is the one place now; /contact stays alive (error pages,
 * old links and emails still point at it) and answers with a permanent
 * redirect so browsers and crawlers learn the new address.
 */
export const metadata: Metadata = {
  title: "Support · DesiAuction",
  alternates: { canonical: `${env.PUBLIC_BASE_URL}/support` },
};

export default function ContactPage(): never {
  permanentRedirect("/support");
}
