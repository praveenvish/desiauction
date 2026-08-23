import { launch, signIn, log, BASE, summariseObserved } from "./lib";
import { seatCaptains, type Captain } from "./captains";
import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const { slug } = JSON.parse(readFileSync("rehearsal/artifacts/season.json", "utf8"));
const roster = JSON.parse(readFileSync("rehearsal/artifacts/captains.json", "utf8")).map(
  (c: any) => ({ name: c.name, phone: c.phone, team: c.team }),
);
const ART = "rehearsal/artifacts";
const TARGET_SOLD = 78;

const nowMs = () => Date.now();

async function leading(p: Page): Promise<string> {
  return (
    (await p
      .getByTestId("leading-bid")
      .innerText()
      .catch(() => "")) +
    "|" +
    (await p
      .getByTestId("leading-team")
      .innerText()
      .catch(() => ""))
  );
}
async function currentLot(p: Page): Promise<string> {
  return (
    await p
      .getByTestId("ribbon-lot")
      .innerText()
      .catch(() => "")
  ).trim();
}
async function bidEnabled(c: Captain): Promise<boolean> {
  return c.page
    .getByTestId("bid-next")
    .isEnabled()
    .catch(() => false);
}

async function main() {
  const b = await launch(true);
  const o = await signIn(b, "Demo Founder", "9999000001");
  const cock = o.page;
  await cock.goto(`${BASE}/seasons/${slug}/auction/cockpit`);
  await cock.waitForLoadState("networkidle");
  const caps = await seatCaptains(b, slug, roster);
  log("seated captains:", caps.map((c) => c.team).join(", "));

  const sold: any[] = [];
  const unsold: string[] = [];
  const latencies: number[] = [];
  const problems: string[] = [];
  const perLotMs: number[] = [];
  let lotNo = 0;
  const t0 = nowMs();

  for (let iter = 0; iter < 140; iter++) {
    const lotStart = nowMs();
    // 1 — open the next lot
    const openNext = cock.getByRole("button", { name: /Open next lot/ });
    if (!(await openNext.isVisible().catch(() => false))) {
      log("no more lots to open at iter", iter);
      break;
    }
    if (!(await openNext.isEnabled().catch(() => false))) {
      await cock.reload();
      await cock.waitForLoadState("networkidle");
      if (!(await openNext.isEnabled().catch(() => false))) {
        log("open-next disabled; stopping");
        break;
      }
    }
    await openNext.click();
    lotNo++;

    // 2 — wait for the block to reach the room
    let ready = false;
    for (let t = 0; t < 60; t++) {
      if (await bidEnabled(caps[0] as Captain)) {
        ready = true;
        break;
      }
      await caps[0]!.page.waitForTimeout(150);
    }
    if (!ready) {
      problems.push(`lot ${lotNo}: bid control never enabled`);
      await cock.waitForTimeout(500);
    }
    const lotId = await currentLot(caps[0]!.page);

    const wantSold = sold.length < TARGET_SOLD;
    if (wantSold) {
      const winner = caps[sold.length % 6] as Captain;
      const rivals = caps.filter((c) => c.i !== winner.i);
      // a couple of rival raises, then the winner takes it
      const order = [rivals[lotNo % 5] as Captain, rivals[(lotNo + 2) % 5] as Captain, winner];
      let prev = "";
      for (const c of order) {
        for (let t = 0; t < 40; t++) {
          if (await bidEnabled(c)) break;
          await c.page.waitForTimeout(100);
        }
        if (!(await bidEnabled(c))) {
          problems.push(`lot ${lotId}: ${c.team} bid disabled`);
          continue;
        }
        const watcher = caps.find((x) => x.i !== c.i) as Captain;
        const before = await leading(watcher.page);
        const tb = nowMs();
        await c.page.getByTestId("bid-next").click();
        // measure propagation to a DIFFERENT device
        for (let t = 0; t < 80; t++) {
          const after = await leading(watcher.page);
          if (after !== before && after.trim() !== "|") {
            latencies.push(nowMs() - tb);
            break;
          }
          await watcher.page.waitForTimeout(50);
        }
        prev = await leading(c.page);
      }
      // 3 — gavel
      const gavel = cock.getByTestId("cockpit-gavel");
      await gavel.scrollIntoViewIfNeeded();
      const box = await gavel.boundingBox();
      if (box) {
        await cock.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await cock.mouse.down();
        await cock.waitForTimeout(800);
        await cock.mouse.up();
      }
      await cock.waitForTimeout(600);
      sold.push({ lotId, team: (caps[sold.length % 6] as Captain).team, leading: prev });
    } else {
      // let it go unsold: gavel with no bids
      const gavel = cock.getByTestId("cockpit-gavel");
      const box = await gavel.boundingBox();
      if (box) {
        await cock.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await cock.mouse.down();
        await cock.waitForTimeout(800);
        await cock.mouse.up();
      }
      await cock.waitForTimeout(600);
      unsold.push(lotId);
    }
    perLotMs.push(nowMs() - lotStart);
    if (lotNo % 10 === 0) {
      log(
        `lot ${lotNo}: sold=${sold.length} unsold=${unsold.length} avg/lot=${Math.round(perLotMs.reduce((a, x) => a + x, 0) / perLotMs.length)}ms`,
      );
    }
    if (sold.length >= TARGET_SOLD && unsold.length >= 2) {
      // stop once the queue can be checked
      const txt = await cock.locator("main").innerText();
      const m = txt.match(/(\d+)\/(\d+) lots · (\d+) in queue/);
      log("queue state:", m?.[0]);
      if (m && Number(m[3]) === 0) break;
    }
  }

  const wall = nowMs() - t0;
  log(
    `\nAUCTION DONE in ${Math.round(wall / 1000)}s — sold=${sold.length} unsold=${unsold.length}`,
  );
  const avgLat = latencies.length
    ? Math.round(latencies.reduce((a, x) => a + x, 0) / latencies.length)
    : -1;
  const sortedLat = [...latencies].sort((a, b) => a - b);
  log(
    `bid propagation to another device: n=${latencies.length} avg=${avgLat}ms p50=${sortedLat[Math.floor(sortedLat.length / 2)]}ms p95=${sortedLat[Math.floor(sortedLat.length * 0.95)]}ms max=${sortedLat[sortedLat.length - 1]}ms`,
  );
  log(`per-lot wall: avg=${Math.round(perLotMs.reduce((a, x) => a + x, 0) / perLotMs.length)}ms`);
  if (problems.length) log("PROBLEMS:", JSON.stringify(problems.slice(0, 25)));
  writeFileSync(
    `${ART}/auction-run.json`,
    JSON.stringify({ sold, unsold, latencies, perLotMs, problems, wall }, null, 2),
  );
  summariseObserved(caps as any);
  await cock.screenshot({ path: `${ART}/59-cockpit-after-run.png`, fullPage: true });
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
