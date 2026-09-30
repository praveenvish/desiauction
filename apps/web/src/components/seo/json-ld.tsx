import { headers } from "next/headers";

import { serializeJsonLd } from "../../server/seo/json-ld";

/**
 * Structured data for search engines (SEO-1 Phase 2).
 *
 * The one place a schema object becomes a `<script type="application/ld+json">`,
 * so every block goes through `serializeJsonLd`. The payloads carry
 * organizer-controlled names, and a raw `JSON.stringify` here is a stored-XSS
 * breakout (PX-11 F2). A null entry renders nothing: builders return null when
 * a required field can't be filled honestly.
 *
 * CARRIES THE REQUEST'S NONCE. A data block never executes, but the policy is
 * "every script element carries the nonce" (content-security-policy.spec.ts),
 * and a page whose scripts are all nonced can move to an enforced policy
 * without auditing which ones happen to be inert. The nonce is minted per
 * request by middleware.ts, exactly as the root layout reads it.
 */
export async function JsonLd({ data }: { data: object | null | readonly (object | null)[] }) {
  const blocks = (Array.isArray(data) ? data : [data]).filter(
    (block): block is object => block !== null,
  );
  if (blocks.length === 0) return null;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      {blocks.map((block, index) => (
        <script
          key={index}
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(block) }}
        />
      ))}
    </>
  );
}
