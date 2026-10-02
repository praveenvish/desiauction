#!/usr/bin/env node
// TELL SEARCH ENGINES WHAT A PRODUCTION DEPLOY CHANGED (IndexNow).
//
// The app already announces season pages the moment an organizer publishes or
// unpublishes one (apps/web/src/server/seo/indexnow.ts). Nothing announced the
// pages a DEPLOY changes — the homepage, pricing, help, guides — so Bing,
// Yandex, Seznam and Naver learned about them only at their next crawl.
//
// This closes that gap without announcing anything that did not change, which
// is what the protocol asks for. The sitemap carries a real content date per
// page (apps/web/src/app/sitemap.ts: "never the deploy time"), so:
//
//   snapshot  before the swap, save the live sitemap — the OLD site;
//   announce  after the swap, read it again — the NEW site — and submit every
//             URL that is new or whose <lastmod> moved, plus the homepage,
//             which carries the site-wide footer and Organization schema that
//             no page date reflects.
//
// NEVER FAILS A DEPLOY. Both commands exit 0 on every path: the deploy has
// already succeeded when this runs, and a search engine being down is not a
// reason to report a release as broken. Without a published key
// (/indexnow-key.txt answers 404 on any host without INDEXNOW_KEY) it does
// nothing. Dependency-free: Node's own fetch, run on the CI runner.
//
//   node scripts/indexnow-announce.mjs snapshot https://desiauction.in before.xml
//   node scripts/indexnow-announce.mjs announce https://desiauction.in before.xml

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ENDPOINT = "https://api.indexnow.org/indexnow";
const KEY_PATH = "/indexnow-key.txt";
const TIMEOUT_MS = 15_000;
// The protocol's ceiling per request.
const MAX_URLS = 10_000;

/** `<loc>` → `<lastmod>` (or "" when a URL has none). */
export function parseSitemap(xml) {
  const pages = new Map();
  for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(block)?.[1];
    if (!loc) continue;
    pages.set(loc, /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(block)?.[1] ?? "");
  }
  return pages;
}

/**
 * Every URL of `after` that is new or whose date moved since `before`, plus
 * the homepage — only URLs on `origin`, the protocol's one-host rule.
 */
export function changedUrls(before, after, origin) {
  const home = `${origin}/`;
  const changed = [];
  for (const [loc, lastmod] of after) {
    if (!loc.startsWith(`${origin}/`)) continue;
    if (loc === home || !before.has(loc) || before.get(loc) !== lastmod) changed.push(loc);
  }
  if (!changed.includes(home)) changed.unshift(home);
  return changed.slice(0, MAX_URLS);
}

/** The body IndexNow expects. */
export function indexNowBody(origin, key, urls) {
  return {
    host: new URL(origin).host,
    key,
    keyLocation: `${origin}${KEY_PATH}`,
    urlList: urls,
  };
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

async function snapshot(origin, file) {
  try {
    writeFileSync(file, await fetchText(`${origin}/sitemap.xml`));
    console.log(`sitemap snapshot saved (${parseSitemap(readFileSync(file, "utf8")).size} URLs)`);
  } catch (error) {
    // No snapshot means "announce" treats every page as new — still correct,
    // just broader. Say so and carry on.
    console.log(`::warning::sitemap snapshot failed: ${error.message}`);
  }
}

async function announce(origin, file) {
  let key;
  try {
    key = (await fetchText(`${origin}${KEY_PATH}`)).trim();
  } catch {
    console.log("no IndexNow key is published; nothing announced");
    return;
  }
  let before = new Map();
  try {
    before = parseSitemap(readFileSync(file, "utf8"));
  } catch {
    console.log("no snapshot from before the swap; announcing every page");
  }
  let after;
  try {
    after = parseSitemap(await fetchText(`${origin}/sitemap.xml`));
  } catch (error) {
    console.log(`::warning::could not read the new sitemap: ${error.message}`);
    return;
  }
  const urls = changedUrls(before, after, origin);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(indexNowBody(origin, key, urls)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 200 and 202 both mean accepted (202: key validation still pending).
    if (!response.ok) {
      console.log(`::warning::IndexNow refused the submission (${response.status})`);
      return;
    }
    console.log(`IndexNow accepted ${urls.length} URL(s) (${response.status}):`);
    for (const url of urls) console.log(`  ${url}`);
  } catch (error) {
    console.log(`::warning::IndexNow submission failed: ${error.message}`);
  }
}

async function main(argv) {
  const [command, origin, file] = argv;
  if (!["snapshot", "announce"].includes(command) || !origin || !file) {
    console.log("usage: indexnow-announce.mjs snapshot|announce <origin> <file>");
    return;
  }
  const base = origin.replace(/\/+$/, "");
  if (command === "snapshot") await snapshot(base, file);
  else await announce(base, file);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
