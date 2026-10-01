import { env } from "../../env";
import { logger } from "../logger";

/**
 * TELL SEARCH ENGINES A PUBLIC PAGE CHANGED, NOW RATHER THAN AT THE NEXT CRAWL
 * (SEO-1 Phase 1).
 *
 * IndexNow is one POST that Bing, Yandex, Seznam and Naver share. Google does
 * not take part, and reads the sitemap instead. A season published tonight
 * would otherwise wait days for a crawler to notice. An unpublished one would
 * keep showing in results for just as long, and that is the direction that
 * matters most, because a page taken down is often taken down on purpose.
 *
 * OFF UNLESS `INDEXNOW_KEY` IS SET. Only production's web.env carries one
 * (init-env.sh), so dev, e2e, CI and staging never announce their URLs. The
 * key is public by design: the protocol proves ownership by serving it at
 * `keyLocation` on the same host (app/indexnow-key.txt/route.ts).
 *
 * NEVER THROWS. It runs in `after()` once the response has gone, and a search
 * engine being down must never be the organizer's problem. A failure is logged
 * and dropped; the sitemap is still the source of truth.
 */
const ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 5_000;

export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";

export async function notifyIndexNow(paths: readonly string[]): Promise<void> {
  const key = env.INDEXNOW_KEY;
  if (key === undefined || paths.length === 0) return;
  const base = new URL(env.PUBLIC_BASE_URL);
  const body = {
    host: base.host,
    key,
    keyLocation: `${base.origin}${INDEXNOW_KEY_PATH}`,
    urlList: paths.map((path) => `${base.origin}${path}`),
  };
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 200 and 202 both mean accepted (202: key validation still pending).
    if (!response.ok) {
      logger().warn({ status: response.status, urls: body.urlList }, "seo.indexnow_refused");
      return;
    }
    logger().info({ urls: body.urlList }, "seo.indexnow_sent");
  } catch (error) {
    logger().warn({ err: error, urls: body.urlList }, "seo.indexnow_failed");
  }
}
