import { launch, signIn, log, BASE } from "./lib";
import { seatCaptains, type Captain } from "./captains";
import { readFileSync } from "node:fs";
const ART = "rehearsal/artifacts";
const cup = JSON.parse(readFileSync(`${ART}/cup.json`, "utf8"));
const slug = cup.slug;
const caps0 = JSON.parse(readFileSync(`${ART}/captains.json`, "utf8"));
const roster = caps0.map((c: any, i: number) => ({
  name: c.name,
  phone: c.phone,
  team: cup.invites[i].team,
}));

const T = { timeout: 1500 };
const txt = async (p: any, id: string) =>
  (
    await p
      .getByTestId(id)
      .innerText(T)
      .catch(() => "-")
  )
    .replace(/\n/g, " ")
    .trim();
const state = async (p: any) => ({
  lot: await txt(p, "ribbon-lot"),
  bid: await txt(p, "leading-bid"),
  leader: await txt(p, "leading-team"),
  timer: await txt(p, "ribbon-timer"),
  conn: await txt(p, "connection-state"),
  v: await txt(p, "ribbon-version"),
});
const canBid = async (p: any) =>
  p
    .getByTestId("bid-next")
    .isEnabled(T)
    .catch(() => false);

async function main() {
  const b = await launch(true);
  const o = await signIn(b, "Demo Founder", "9999000001");
  const cock = o.page;
  await cock.goto(`${BASE}/seasons/${slug}/auction/cockpit`, { waitUntil: "networkidle" });
  const caps = await seatCaptains(b, slug, roster.slice(0, 3));
  const [c1, c2, c3] = caps as [Captain, Captain, Captain];

  // put a lot on the block with a bid standing
  const openNext = cock.getByRole("button", { name: /Open next lot/ });
  if (await openNext.isEnabled(T).catch(() => false)) {
    await openNext.click();
    await cock.waitForTimeout(3000);
  }
  log("lot on block:", await txt(c1.page, "ribbon-lot"));
  await c1.page
    .getByTestId("bid-next")
    .click(T)
    .catch(() => {});
  await cock.waitForTimeout(2000);
  log("baseline:", JSON.stringify(await state(c2.page)));

  // 1 — HARD REFRESH mid-lot
  await c2.page.reload({ waitUntil: "networkidle" });
  await c2.page.waitForTimeout(2500);
  log("1 after hard refresh:", JSON.stringify(await state(c2.page)));
  log("   can still bid:", await canBid(c2.page));

  // 2 — BACK then FORWARD
  await c2.page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await c2.page.goBack({ waitUntil: "networkidle" });
  await c2.page.waitForTimeout(2500);
  log("2 after back:", JSON.stringify(await state(c2.page)));
  log("   can still bid:", await canBid(c2.page));

  // 3 — DUPLICATE TAB: same captain, two live rooms
  const dup = await c2.ctx.newPage();
  await dup.goto(`${BASE}/seasons/${slug}/auction/live`, { waitUntil: "networkidle" });
  await dup.waitForTimeout(2500);
  log("3 duplicate tab:", JSON.stringify(await state(dup)));
  await c3.page
    .getByTestId("bid-next")
    .click(T)
    .catch(() => {});
  await cock.waitForTimeout(2500);
  const s1 = await state(c2.page),
    s2 = await state(dup);
  log("   tab A:", JSON.stringify(s1));
  log("   tab B:", JSON.stringify(s2));
  log("   two tabs agree:", s1.bid === s2.bid && s1.leader === s2.leader ? "YES" : "NO");
  // bidding from the duplicate tab
  const dupCanBid = await canBid(dup);
  log("   duplicate tab can bid:", dupCanBid);
  if (dupCanBid) {
    await dup.getByTestId("bid-next").click(T);
    await cock.waitForTimeout(2500);
    log("   after bidding from tab B — tab A:", JSON.stringify(await state(c2.page)));
  }
  await dup.close();

  // 4 — NETWORK DROP then recovery
  await c2.ctx.setOffline(true);
  await c2.page.waitForTimeout(9000);
  log("4 while offline:", JSON.stringify(await state(c2.page)));
  log("   bid control while offline:", await canBid(c2.page));
  await c2.page.screenshot({ path: `${ART}/81-offline.png`, fullPage: true });
  await c2.ctx.setOffline(false);
  await c2.page.waitForTimeout(9000);
  log("   after reconnect:", JSON.stringify(await state(c2.page)));
  log("   bid control after reconnect:", await canBid(c2.page));

  // 5 — PAUSE / RESUME mid-lot
  await cock.getByTestId("cockpit-pause").click();
  await cock.waitForTimeout(3000);
  log("5 paused — captain sees:", JSON.stringify(await state(c1.page)));
  log("   bid control while paused:", await canBid(c1.page));
  log("   message:", await txt(c1.page, "paddle-leading"));
  await c1.page.screenshot({ path: `${ART}/82-paused.png`, fullPage: true });
  const resume = cock.getByTestId("cockpit-resume");
  await resume.click();
  await cock.waitForTimeout(3000);
  log("   after resume:", JSON.stringify(await state(c1.page)));
  log("   bid control after resume:", await canBid(c1.page));
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
