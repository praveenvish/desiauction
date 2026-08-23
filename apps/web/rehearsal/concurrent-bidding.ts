import { launch, signIn, log, BASE, summariseObserved } from "./lib";
import { seatCaptains, type Captain } from "./captains";
import { readFileSync, writeFileSync } from "node:fs";
const ART = "rehearsal/artifacts";
const { slug } = JSON.parse(readFileSync(`${ART}/cup.json`, "utf8"));
const caps0 = JSON.parse(readFileSync(`${ART}/captains.json`, "utf8"));
const cup = JSON.parse(readFileSync(`${ART}/cup.json`, "utf8"));
const roster = caps0.map((c: any, i: number) => ({
  name: c.name,
  phone: c.phone,
  team: cup.invites[i].team,
}));

const read = async (c: Captain) => ({
  team: c.team,
  bid: (
    await c.page
      .getByTestId("leading-bid")
      .innerText()
      .catch(() => "-")
  ).replace(/\n/g, " "),
  leader: (
    await c.page
      .getByTestId("leading-team")
      .innerText()
      .catch(() => "-")
  ).replace(/\n/g, " "),
  v: (
    await c.page
      .getByTestId("ribbon-version")
      .innerText()
      .catch(() => "-")
  ).trim(),
  canBid: await c.page
    .getByTestId("bid-next")
    .isEnabled()
    .catch(() => false),
  next: (
    await c.page
      .getByTestId("bid-next")
      .innerText()
      .catch(() => "-")
  ).replace(/\n/g, " "),
});

async function main() {
  const b = await launch(true);
  const o = await signIn(b, "Demo Founder", "9999000001");
  const cock = o.page;
  await cock.goto(`${BASE}/seasons/${slug}/auction/cockpit`, { waitUntil: "networkidle" });
  const openAuction = cock.getByRole("button", { name: /^Open auction$/ });
  if (await openAuction.isVisible().catch(() => false)) {
    await openAuction.click();
    await cock.waitForTimeout(3500);
    log("auction opened");
  }
  const caps = await seatCaptains(b, slug, roster);
  const results: any[] = [];

  await cock.getByRole("button", { name: /Open next lot/ }).click();
  for (let t = 0; t < 80; t++) {
    if (
      await caps[0]!.page
        .getByTestId("bid-next")
        .isEnabled()
        .catch(() => false)
    )
      break;
    await caps[0]!.page.waitForTimeout(150);
  }
  const lot = (
    await caps[0]!.page
      .getByTestId("ribbon-lot")
      .innerText()
      .catch(() => "?")
  )
    .replace(/\n/g, " ")
    .trim();
  log(`LOT ON BLOCK: ${lot}`);
  log("before:", JSON.stringify(await read(caps[0] as Captain)));

  // ---- BURST 1: all six, same instant ---------------------------------------
  for (let round = 1; round <= 4; round++) {
    const states = await Promise.all(caps.map(read));
    const eligible = states.filter((s) => s.canBid).length;
    const t0 = Date.now();
    const clicks = await Promise.all(
      caps.map(async (c) => {
        const t = Date.now();
        try {
          await c.page.getByTestId("bid-next").click({ timeout: 4000 });
          return { team: c.team, ok: true, ms: Date.now() - t };
        } catch {
          return { team: c.team, ok: false, ms: Date.now() - t };
        }
      }),
    );
    await cock.waitForTimeout(2500);
    const after = await Promise.all(caps.map(read));
    const distinct = new Set(after.map((s) => `${s.bid}|${s.leader}`));
    const feed = (
      await caps[0]!.page
        .getByTestId("bid-feed")
        .innerText()
        .catch(() => "")
    ).replace(/\n+/g, " | ");
    log(
      `\nBURST ${round}: eligible=${eligible} clicked=${clicks.filter((c) => c.ok).length} wall=${Date.now() - t0}ms`,
    );
    log("  clicks:", JSON.stringify(clicks));
    log("  states:", JSON.stringify(after.map((s) => `${s.team}:${s.bid}/${s.leader}/${s.v}`)));
    log("  distinct views:", distinct.size, distinct.size === 1 ? "CONVERGED" : "DIVERGED");
    log("  feed:", feed.slice(0, 420));
    results.push({
      round,
      clicks,
      after,
      converged: distinct.size === 1,
      feed: feed.slice(0, 800),
    });
  }
  // bid ledger truth
  const cockText = await cock.locator("main").innerText();
  log(
    "\nCOCKPIT BID FEED:",
    (cockText.match(/Bid feed[\s\S]{0,700}/)?.[0] ?? "").replace(/\n+/g, " | "),
  );
  writeFileSync(`${ART}/burst-real.json`, JSON.stringify(results, null, 2));
  summariseObserved(caps as any);
  await cock.screenshot({ path: `${ART}/76-burst-cockpit.png`, fullPage: true });
  await caps[0]!.page.screenshot({ path: `${ART}/77-burst-captain.png`, fullPage: true });
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
