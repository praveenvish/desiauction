import type { Db } from "@desiauction/db";
import { publicPage } from "./public-page";
/** A bearer grants only its own match; the slug and number still have to agree. */
export async function overlayPageFacts(
  address: { slug: string; fixtureNumber: string },
  token: string | string[] | undefined,
  reader?: Db,
) {
  let fixtureNumber: string;
  try {
    fixtureNumber = decodeURIComponent(address.fixtureNumber);
  } catch {
    return null;
  }
  if (token !== undefined && (typeof token !== "string" || !token || token.length > 128))
    return null;
  const facts = await publicPage(token ? { token } : { slug: address.slug, fixtureNumber }, reader);
  return facts?.slug === address.slug && facts.fixtureNumber === fixtureNumber ? facts : null;
}
