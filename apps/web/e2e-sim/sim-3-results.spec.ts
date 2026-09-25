import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { COLD, OUT, loadState, log, shot } from "./sim-lib";

test("stage 3 — results, squads and share cards", async ({ browser }) => {
  const state = loadState();
  const { slug, seasonUrl } = state;
  const ctx = await browser.newContext({ storageState: state.organizer.storage });
  const org = await ctx.newPage();
  const errors: string[] = [];
  org.on("pageerror", (e) => errors.push(`${org.url()}: ${e.message}`));

  await org.goto(seasonUrl);
  await expect(org.getByTestId("season-completed")).toBeVisible(COLD);
  log(`season page: ${(await org.getByTestId("season-completed").textContent())?.trim()}`);
  await shot(org, "50-season-overview");

  await org.goto(`${seasonUrl}/teams`);
  await shot(org, "51-teams");
  await org.goto(`/seasons/${slug}/auction`);
  await shot(org, "52-auction-summary");

  await org.goto(`/seasons/${slug}/posters`);
  await expect(org.locator("main")).toBeVisible(COLD);
  await org.waitForTimeout(1500);
  await shot(org, "53-poster-studio");

  const urls = new Set<string>();
  for (const sel of ['a[href*="/posters/"]', 'img[src*="/posters/"]']) {
    for (const el of await org.locator(sel).all()) {
      const v = (await el.getAttribute(sel.startsWith("a") ? "href" : "src")) ?? "";
      if (v) urls.add(new URL(v, org.url()).pathname + new URL(v, org.url()).search);
    }
  }
  log(`poster studio exposes ${urls.size} card urls`);
  const cards: { url: string; status: number; type: string; kb: number; ms: number }[] = [];
  let i = 0;
  for (const u of urls) {
    const t = Date.now();
    const res = await ctx.request.get(u);
    const body = await res.body();
    const type = res.headers()["content-type"] ?? "";
    const rec = {
      url: u,
      status: res.status(),
      type,
      kb: Math.round(body.length / 1024),
      ms: Date.now() - t,
    };
    cards.push(rec);
    if (type.startsWith("image/")) {
      const ext = type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : "img";
      writeFileSync(
        path.join(
          OUT,
          `card-${String(i++).padStart(2, "0")}-${u
            .split("/posters/")[1]!
            .replace(/[/?=&]/g, "_")
            .slice(0, 60)}.${ext}`,
        ),
        body,
      );
    }
    log(`   ${rec.status} ${type} ${rec.kb}KB ${rec.ms}ms ${u}`);
  }

  // Owners see their own squad.
  for (const o of state.owners) {
    const octx = await browser.newContext({ storageState: o.storage });
    const p = await octx.newPage();
    p.on("pageerror", (e) => errors.push(`${o.team} ${p.url()}: ${e.message}`));
    await p.goto("/home");
    await shot(p, `55-owner-home-${o.team.split(" ")[0]}`);
    await octx.close();
  }

  writeFileSync(path.join(OUT, "cards.json"), JSON.stringify({ cards, errors }, null, 2));
  log(`page errors: ${errors.length} ${errors.join(" | ")}`);
  expect(cards.filter((c) => c.status >= 400)).toEqual([]);
});
