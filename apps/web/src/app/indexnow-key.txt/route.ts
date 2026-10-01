import { env } from "../../env";

/**
 * The IndexNow ownership proof: the key, as plain text, on our own host
 * (server/seo/indexnow.ts). It is 404 wherever no key is configured, so a
 * development or staging host never claims to be the site.
 */
export function GET(): Response {
  const key = env.INDEXNOW_KEY;
  if (key === undefined) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(key, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
