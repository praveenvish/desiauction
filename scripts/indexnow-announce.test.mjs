// Unit tests for the deploy-time IndexNow announcement. Run: pnpm test:scripts
//
// The network half (fetching the sitemap and key, the POST) is exercised by
// the production deploy; what is pinned here is the decision of WHAT to
// announce — only real changes, always the homepage, never another host.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { changedUrls, indexNowBody, parseSitemap } from "./indexnow-announce.mjs";

const ORIGIN = "https://desiauction.in";
const SCRIPT = fileURLToPath(new URL("./indexnow-announce.mjs", import.meta.url));

const sitemap = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(([loc, lastmod]) =>
      lastmod === undefined
        ? `<url>\n<loc>${loc}</loc>\n</url>`
        : `<url>\n<loc>${loc}</loc>\n<lastmod>${lastmod}</lastmod>\n<changefreq>monthly</changefreq>\n</url>`,
    )
    .join("\n")}\n</urlset>`;

test("a sitemap parses to loc → lastmod, with '' where a URL has no date", () => {
  const pages = parseSitemap(
    sitemap([
      [`${ORIGIN}/`, "2026-09-30"],
      [`${ORIGIN}/pricing`, "2026-09-27"],
      [`${ORIGIN}/help/category/start`, undefined],
    ]),
  );
  assert.deepEqual(
    [...pages],
    [
      [`${ORIGIN}/`, "2026-09-30"],
      [`${ORIGIN}/pricing`, "2026-09-27"],
      [`${ORIGIN}/help/category/start`, ""],
    ],
  );
});

test("only new pages and pages whose date moved are announced — plus the homepage", () => {
  const before = parseSitemap(
    sitemap([
      [`${ORIGIN}/`, "2026-09-30"],
      [`${ORIGIN}/pricing`, "2026-09-27"],
      [`${ORIGIN}/features`, "2026-09-26"],
    ]),
  );
  const after = parseSitemap(
    sitemap([
      [`${ORIGIN}/`, "2026-09-30"],
      [`${ORIGIN}/pricing`, "2026-10-02"],
      [`${ORIGIN}/features`, "2026-09-26"],
      [`${ORIGIN}/guides/new-guide`, "2026-10-02"],
    ]),
  );
  assert.deepEqual(changedUrls(before, after, ORIGIN), [
    `${ORIGIN}/`,
    `${ORIGIN}/pricing`,
    `${ORIGIN}/guides/new-guide`,
  ]);
});

test("an unchanged site still announces the homepage — its footer and schema have no date", () => {
  const same = parseSitemap(
    sitemap([
      [`${ORIGIN}/`, "2026-09-30"],
      [`${ORIGIN}/about`, "2026-09-26"],
    ]),
  );
  assert.deepEqual(changedUrls(same, same, ORIGIN), [`${ORIGIN}/`]);
});

test("without a snapshot every page counts as new", () => {
  const after = parseSitemap(
    sitemap([
      [`${ORIGIN}/`, "2026-09-30"],
      [`${ORIGIN}/about`, "2026-09-26"],
    ]),
  );
  assert.deepEqual(changedUrls(new Map(), after, ORIGIN), [`${ORIGIN}/`, `${ORIGIN}/about`]);
});

test("a URL on another host is never announced (IndexNow's one-host rule)", () => {
  const after = parseSitemap(
    sitemap([
      [`${ORIGIN}/`, "2026-09-30"],
      ["https://staging.desiauction.in/pricing", "2026-10-02"],
      ["https://desiauction.in.evil.example/x", "2026-10-02"],
    ]),
  );
  assert.deepEqual(changedUrls(new Map(), after, ORIGIN), [`${ORIGIN}/`]);
});

test("the body names the host, the key and where the key is published", () => {
  assert.deepEqual(indexNowBody(ORIGIN, "abc123", [`${ORIGIN}/`]), {
    host: "desiauction.in",
    key: "abc123",
    keyLocation: `${ORIGIN}/indexnow-key.txt`,
    urlList: [`${ORIGIN}/`],
  });
});

test("bad arguments print usage and still exit 0 — it can never fail a deploy", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "nonsense"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage:/);
});
