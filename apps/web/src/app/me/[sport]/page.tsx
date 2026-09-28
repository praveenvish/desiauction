import { sportPack } from "@desiauction/core";
import { notFound, permanentRedirect } from "next/navigation";

/**
 * /me/cricket, /me/football … — once one sport's career page, now the sport
 * filter on My profile (/me?sport=). The address keeps working for every link
 * and bookmark made before; a sport this platform has no pack for is still
 * ABSENT, not an empty profile.
 */
export default async function MySportRedirect({ params }: { params: Promise<{ sport: string }> }) {
  const pack = sportPack((await params).sport);
  if (pack === null) {
    notFound();
  }
  permanentRedirect(`/me?sport=${pack.key}`);
}
