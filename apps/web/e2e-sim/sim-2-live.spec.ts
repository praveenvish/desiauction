import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  COLD,
  OUT,
  PLAYERS,
  TEAMS,
  loadState,
  log,
  nextRung,
  points,
  shot,
  type TeamName,
} from "./sim-lib";

/*
 * STAGE 2 — THE NIGHT. One conductor on the cockpit, three owners in their own
 * browsers, a big screen on /board. Every sale is at least two bids where two
 * teams can still buy; one player takes more than half a purse; eight go
 * unsold in round one, one of them sells in round two; and the night is
 * interrupted on purpose: a reload, a double-click, a simultaneous bid, a
 * pause, a clock-run-out with an anti-snipe, and an undo.
 */

const PURSE = 100_000;
const SQUAD = 12;
const BASE = 1000;
const STAR = "Arjun Deshmukh";
const STAR_WINNER: TeamName = "Mumbai Mavericks";
const STAR_PRICE = 52_500;
// Unsold in round 1, sold in round 2 (the second is the night's last slot).
const RETURNS = new Set(["Kabir Sethi", "Tushar Dubey"]);
const UNSOLD = new Set([
  ...RETURNS,
  "Hemant Soni",
  "Bhavesh Trivedi",
  "Tushar Dubey",
  "Neeraj Bisht",
  "Pankaj Rawat",
  "Umesh Negi",
  "Jatin Parekh",
]);
const BAND = new Map(PLAYERS.map((p) => [p.name, p.band]));

interface Owner {
  team: TeamName;
  page: Page;
  purse: number;
  squad: number;
}

interface LotRecord {
  round: number;
  lotNumber: string;
  player: string;
  outcome: "sold" | "unsold";
  team: TeamName | null;
  price: number | null;
  bids: number;
  bidders: TeamName[];
  scenario: string | null;
  ms: number;
}

// Deterministic "randomness".
let seed = 20260925;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function ceilingOf(o: Owner): number {
  const stillNeeded = Math.max(0, SQUAD - o.squad - 1);
  return Math.max(0, o.purse - stillNeeded * BASE);
}
function floorToRung(x: number): number {
  let v = BASE;
  while (nextRung(v) <= x) v = nextRung(v);
  return v;
}

test("stage 2 — the live auction, end to end", async ({ browser }) => {
  const state = loadState();
  const { slug } = state;
  const latencies: number[] = [];
  const propagation: number[] = [];
  const records: LotRecord[] = [];
  const issues: string[] = [];
  const note = (s: string) => {
    issues.push(s);
    log(`!! ${s}`);
  };

  // --- Everyone takes their seat -------------------------------------------------
  const orgCtx = await browser.newContext({ storageState: state.organizer.storage });
  const org = await orgCtx.newPage();
  const board = await orgCtx.newPage();
  const owners: Owner[] = [];
  for (const o of state.owners) {
    const ctx = await browser.newContext({ storageState: o.storage });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => note(`${o.team} page error: ${e.message}`));
    owners.push({ team: o.team, page, purse: PURSE, squad: 2 });
  }
  org.on("pageerror", (e) => note(`organizer page error on ${org.url()}: ${e.message}`));
  org.on("console", (m) => {
    if (m.type() === "error" && /hydrat|did not match|418/i.test(m.text()))
      log(`CONSOLE(${org.url()}): ${m.text().slice(0, 3000)}`);
  });
  const byTeam = (t: TeamName) => owners.find((o) => o.team === t)!;

  for (const o of owners) {
    await o.page.goto(`/seasons/${slug}/auction/live`);
    await expect(o.page.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true", COLD);
    await o.page.getByLabel("Team", { exact: true }).selectOption({ label: o.team });
    await o.page.getByTestId("claim-paddle").click();
    await expect(o.page.getByTestId("my-paddle")).toBeVisible(COLD);
    log(`${o.team} claimed a paddle`);
  }

  log("step: organizer opens /auction");
  await org.goto(`/seasons/${slug}/auction`);
  await expect(org.getByTestId("auction-panel")).toHaveAttribute("data-hydrated", "true", COLD);
  log("step: auction panel hydrated, clicking queue-all");
  await org.getByTestId("queue-all").click();
  await expect(org.locator('[data-testid^="lot-L0"]').first()).toContainText("queued", COLD);
  const shortOpen = org.getByTestId("accept-short-open");
  if (await shortOpen.isVisible().catch(() => false)) await shortOpen.check();
  await shot(org, "10-go-live-ready");
  log("step: clicking auction-open");
  await org.getByTestId("auction-open").click();
  await expect(org.getByTestId("auction-status")).toHaveText("live", COLD);
  log("AUCTION LIVE");

  await org.goto(`/seasons/${slug}/auction/cockpit`);
  await expect(org.getByTestId("cockpit-panel")).toBeVisible(COLD);
  await board.goto(`/seasons/${slug}/auction/board`);
  for (const o of owners) {
    await expect(o.page.getByTestId("connection-state")).toHaveText("open", COLD);
  }

  // --- Helpers ------------------------------------------------------------------------
  const leadingTeam = async (p: Page) => (await p.getByTestId("leading-team").textContent()) ?? "";
  const leadingAmount = async (p: Page) => {
    const t = await p
      .getByTestId("leading-bid")
      .textContent()
      .catch(() => null);
    const n = points(t);
    return Number.isNaN(n) ? null : n;
  };
  const synced = async (who: Owner, team: TeamName, amount: number) => {
    await expect(who.page.getByTestId("leading-team")).toContainText(team, { timeout: 10_000 });
    await expect.poll(async () => leadingAmount(who.page), { timeout: 10_000 }).toBe(amount);
  };

  /** One bid by `o`. `jump` = amount of a jump chip, otherwise "raise to". */
  async function bid(o: Owner, expectAmount: number, jump?: number): Promise<void> {
    const btn: Locator = jump
      ? o.page.getByTestId(`bid-jump-${String(jump * 100)}`)
      : o.page.getByTestId("bid-next");
    await expect(btn).toBeEnabled({ timeout: 10_000 });
    if (!jump) {
      const shown = points(await btn.textContent());
      if (shown !== expectAmount)
        note(`${o.team}: raise button shows ${shown}, ladder says ${expectAmount}`);
    }
    const t = Date.now();
    await btn.click();
    await synced(o, o.team, expectAmount);
    latencies.push(Date.now() - t);
    const other = owners.find((x) => x !== o)!;
    await synced(other, o.team, expectAmount);
    propagation.push(Date.now() - t);
  }

  async function gavel(): Promise<void> {
    const g = org.getByTestId("cockpit-gavel");
    await expect(g).toBeEnabled();
    await g.hover();
    await org.mouse.down();
    await org.waitForTimeout(900);
    await org.mouse.up();
    await expect(g).toBeHidden({ timeout: 20_000 });
  }

  async function currentPlayer(): Promise<{ name: string; lotNumber: string }> {
    const hero = owners[0]!.page.getByTestId("current-lot");
    await expect(hero).toBeVisible({ timeout: 20_000 });
    const text = (await hero.textContent()) ?? "";
    const name = PLAYERS.map((p) => p.name).find((n) => text.includes(n));
    if (name === undefined) throw new Error(`no known player in lot hero: ${text}`);
    const openText = (await org.getByTestId("cockpit-panel").textContent()) ?? "";
    const lotNumber = /L\d{3}/.exec(text)?.[0] ?? /L\d{3}/.exec(openText)?.[0] ?? "?";
    return { name, lotNumber };
  }

  function pickWinner(name: string): Owner | null {
    if (name === STAR) return byTeam(STAR_WINNER);
    const open = owners.filter((o) => o.squad < SQUAD);
    if (open.length === 0) return null;
    // Before the star is sold, keep Mumbai and Pune able to fight for him.
    const starSold = records.some((r) => r.player === STAR && r.outcome === "sold");
    open.sort((a, b) => a.squad - b.squad || b.purse - a.purse);
    const best = open[0]!;
    if (!starSold && best.team === STAR_WINNER && open.length > 1 && best.squad >= 4)
      return open[1]!;
    return best;
  }

  function targetFor(name: string, w: Owner): number {
    if (name === STAR) return STAR_PRICE;
    const slots = SQUAD - w.squad;
    const starSold = records.some((r) => r.player === STAR && r.outcome === "sold");
    let spend = w.purse;
    // keep the star war affordable for Mumbai and Pune until it happens
    if (!starSold && (w.team === STAR_WINNER || w.team === "Pune Panthers")) {
      spend = Math.max(0, w.purse - (w.team === STAR_WINNER ? STAR_PRICE : 50_000));
    }
    const fair = spend / Math.max(1, slots);
    const factor =
      BAND.get(name) === "A"
        ? 1.4 + rand()
        : BAND.get(name) === "B"
          ? 0.6 + rand()
          : 0.25 + rand() * 0.6;
    let t = floorToRung(Math.max(BASE + 500, fair * factor));
    const cap = ceilingOf(w) - (slots > 1 ? 0 : 0);
    const spendCap =
      !starSold && (w.team === STAR_WINNER || w.team === "Pune Panthers")
        ? spend - (slots - 1) * BASE
        : cap;
    t = Math.min(t, floorToRung(Math.max(BASE, Math.min(cap, spendCap))));
    return t;
  }

  async function sellLot(
    name: string,
    winner: Owner,
    target: number,
    opts: { rivalCaps?: Partial<Record<TeamName, number>>; scenario?: string | null },
  ): Promise<{ bids: number; bidders: TeamName[]; price: number; leader: Owner }> {
    let current: number | null = null;
    let leader: Owner | null = null;
    let bids = 0;
    const bidders: TeamName[] = [];
    const scenario = opts.scenario ?? null;
    const doBid = async (o: Owner, amount: number, jump?: number) => {
      await bid(o, amount, jump);
      current = amount;
      leader = o;
      bids += 1;
      bidders.push(o.team);
      for (const x of owners) {
        if (x === o || x.squad >= SQUAD || ceilingOf(x) >= nextRung(amount)) continue;
        await expect(x.page.getByTestId("bid-next")).toBeDisabled({ timeout: 5000 });
        await expect(x.page.getByTestId("paddle-leading")).toHaveAttribute(
          "data-reason",
          "too-dear",
        );
        if (!budgetChecks.includes(`${x.team}-too-dear`)) {
          budgetChecks.push(`${x.team}-too-dear`);
          const msg = (await x.page.getByTestId("paddle-leading").textContent())?.trim();
          log(
            `   ✓ ${x.team} priced out at ${nextRung(amount)} (ceiling ${ceilingOf(x)}): "${msg}"`,
          );
          await shot(x.page, `31-priced-out-${x.team.split(" ")[0]}`);
        }
      }
    };
    const rivals = () =>
      owners.filter(
        (o) =>
          o !== winner &&
          o.squad < SQUAD &&
          ceilingOf(o) >= nextRung(current) &&
          nextRung(current) <= (opts.rivalCaps?.[o.team] ?? Infinity),
      );
    let turn = 0;

    // SCENARIO: simultaneous opening bids from two teams.
    if (scenario === "simultaneous" && rivals().length >= 1) {
      const r = rivals()[0]!;
      const a = winner.page.getByTestId("bid-next");
      const b = r.page.getByTestId("bid-next");
      await Promise.all([expect(a).toBeEnabled(), expect(b).toBeEnabled()]);
      await Promise.all([a.click(), b.click()]);
      await org.waitForTimeout(1500);
      const lt = await leadingTeam(winner.page);
      const amt = await leadingAmount(winner.page);
      const lead = owners.find((o) => lt.includes(o.team));
      log(`   simultaneous bids at ${BASE}: engine accepted ${lead?.team ?? "?"} at ${amt}`);
      if (amt !== BASE)
        note(`simultaneous: expected one accepted bid at ${BASE}, board shows ${amt}`);
      for (const o of owners) {
        const lt2 = await leadingTeam(o.page);
        if (!lt.includes(lead?.team ?? "@@") || !lt2.includes(lead?.team ?? "@@"))
          note(`simultaneous: ${o.team} sees leader "${lt2}" vs "${lt}"`);
      }
      current = amt;
      leader = lead ?? null;
      bids += 1;
      bidders.push(lead!.team);
    }

    for (let guard = 0; guard < 400; guard += 1) {
      const nxt = nextRung(current);
      if (leader === winner) {
        if (nxt >= target && current !== null && current >= target) break;
        const rs = rivals().filter(() => nxt <= target || bids < 2);
        if (rs.length === 0 || (nxt > target && bids >= 2)) break;
        const r = rs[turn++ % rs.length]!;
        // SCENARIO: the rival reloads the page mid-lot, then bids.
        if (scenario === "reload" && bids === 2) {
          await r.page.reload();
          await expect(r.page.getByTestId("live-panel")).toHaveAttribute(
            "data-hydrated",
            "true",
            COLD,
          );
          await expect(r.page.getByTestId("connection-state")).toHaveText("open", COLD);
          await synced(r, winner.team, current!);
          log(`   ${r.team} reloaded mid-lot, back in sync at ${current}`);
        }
        // SCENARIO: an impatient double-click must land ONE bid.
        if (scenario === "double-click" && bids === 1) {
          const t = Date.now();
          await r.page.getByTestId("bid-next").dblclick();
          await synced(r, r.team, nxt);
          await org.waitForTimeout(1200);
          const after = await leadingAmount(winner.page);
          const lt = await leadingTeam(winner.page);
          log(
            `   ${r.team} double-clicked raise → leading ${after} (${lt}) in ${Date.now() - t}ms`,
          );
          if (after !== nxt || !lt.includes(r.team))
            note(`double-click landed ${after} not ${nxt}`);
          current = nxt;
          leader = r;
          bids += 1;
          bidders.push(r.team);
          continue;
        }
        await doBid(r, nxt);
      } else {
        if (nxt > ceilingOf(winner)) {
          note(`${winner.team} cannot afford ${nxt} on ${name}`);
          break;
        }
        // Far from target: the winner jumps with the ladder chips.
        let jump: number | undefined;
        const topCap = Math.max(0, ...Object.values(opts.rivalCaps ?? {}).map((v) => v ?? 0));
        if (topCap > 0 && nxt === topCap && nextRung(nxt) <= target) jump = nextRung(nxt);
        else if (target - nxt > 3000) {
          const chips = await winner.page
            .locator('[data-testid^="bid-jump-"]')
            .evaluateAll((els) =>
              els
                .filter((e) => !(e as HTMLButtonElement).disabled)
                .map((e) => Number(e.getAttribute("data-testid")!.slice(9)) / 100),
            );
          const fit = chips.filter((c) => c <= target && c > nxt && (topCap === 0 || c < topCap));
          if (fit.length > 0) jump = Math.max(...fit);
        }
        // SCENARIO: pause mid-lot; nobody can bid; resume.
        if (scenario === "pause" && bids === 2) {
          const c0 = Number(await owners[0]!.page.getByTestId("countdown").textContent());
          await org.getByTestId("cockpit-pause").click();
          for (const o of owners) {
            await expect(o.page.getByTestId("lot-paused")).toBeVisible(COLD);
            await expect(o.page.getByTestId("paddle-leading")).toHaveAttribute(
              "data-reason",
              "paused",
              COLD,
            );
            await expect(o.page.getByTestId("bid-next")).toBeDisabled();
          }
          await shot(winner.page, "20-paused-owner-view");
          await org.waitForTimeout(5000);
          await org.getByTestId("cockpit-resume").click();
          await expect(winner.page.getByTestId("bid-next")).toBeEnabled(COLD);
          const c1 = Number(await owners[0]!.page.getByTestId("countdown").textContent());
          log(`   paused 5s: every paddle locked; clock ${c0}s before → ${c1}s after resume`);
          if (Math.abs(c1 - c0) > 2) note(`clock did not hold during pause: ${c0}s → ${c1}s`);
        }
        await doBid(winner, jump ?? nxt, jump);
      }
    }
    return { bids, bidders, price: current ?? 0, leader: (leader as Owner | null) ?? winner };
  }

  // --- The rounds --------------------------------------------------------------------
  // Keyed by the Nth SALE (unsold lots don't count).
  const scenarios: Record<number, string> = {
    2: "reload",
    3: "double-click",
    5: "simultaneous",
    7: "pause",
    9: "clock",
    11: "undo",
    24: "budget-wall",
  };
  let opened = 0;
  let undoDone = false;
  const budgetChecks: string[] = [];

  async function runRound(round: number): Promise<void> {
    for (;;) {
      const openNext = org.getByTestId("cockpit-open-next");
      await expect(openNext).toBeVisible({ timeout: 30_000 });
      if (await openNext.isDisabled()) break;
      const t0 = Date.now();
      await openNext.click();
      opened += 1;
      const { name, lotNumber } = await currentPlayer();
      for (const o of owners)
        await expect(o.page.getByTestId("current-lot")).toContainText(name, COLD);

      // Guard rails a real owner sees: full squads and thin purses.
      for (const o of owners) {
        const pl = o.page.getByTestId("paddle-leading");
        const reason = (await pl.count()) > 0 ? await pl.getAttribute("data-reason") : null;
        if (o.squad >= SQUAD && reason !== "squad-full")
          note(`${o.team} is full but paddle says ${reason}`);
        if (
          o.squad >= SQUAD &&
          reason === "squad-full" &&
          !budgetChecks.includes(`${o.team}-full`)
        ) {
          budgetChecks.push(`${o.team}-full`);
          log(`   ✓ ${o.team} squad full → paddle locked ("Your squad is full.")`);
          await shot(o.page, `30-squad-full-${o.team.split(" ")[0]}`);
        }
        if (o.squad < SQUAD) {
          const ceil = ceilingOf(o);
          const tooDear = await o.page.locator('[data-testid^="bid-jump-"]').evaluateAll(
            (els, c) =>
              els
                .map((e) => ({
                  amt: Number(e.getAttribute("data-testid")!.slice(9)) / 100,
                  disabled: (e as HTMLButtonElement).disabled,
                  title: e.getAttribute("title"),
                }))
                .filter((x) => x.amt > c),
            ceil,
          );
          for (const chip of tooDear) {
            if (!chip.disabled) note(`${o.team}: chip ${chip.amt} enabled above ceiling ${ceil}`);
            else if (!budgetChecks.includes(`${o.team}-chip`)) {
              budgetChecks.push(`${o.team}-chip`);
              log(`   ✓ ${o.team} ceiling ${ceil}: chip ${chip.amt} disabled — "${chip.title}"`);
            }
          }
        }
      }

      const plannedUnsold = round === 1 ? UNSOLD.has(name) : !RETURNS.has(name);
      let scenario: string | null = null;
      const winner = plannedUnsold ? null : pickWinner(name);
      const saleNo = records.filter((r) => r.outcome === "sold").length + 1;
      if (winner !== null && name !== STAR) scenario = scenarios[saleNo] ?? null;
      if (scenario === "undo" && undoDone) scenario = null;

      if (winner === null) {
        await org.waitForTimeout(400);
        await gavel();
        records.push({
          round,
          lotNumber,
          player: name,
          outcome: "unsold",
          team: null,
          price: null,
          bids: 0,
          bidders: [],
          scenario: null,
          ms: Date.now() - t0,
        });
        log(`${lotNumber} ${name}: UNSOLD (no bids) [${Date.now() - t0}ms]`);
        continue;
      }

      let target = targetFor(name, winner);
      if (scenario === "budget-wall") {
        // Push the price past the thinnest purse still in the room.
        const thin = owners
          .filter((o) => o !== winner && o.squad < SQUAD)
          .sort((a, b) => ceilingOf(a) - ceilingOf(b))[0];
        if (thin) {
          target = floorToRung(Math.min(ceilingOf(winner) - 1000, ceilingOf(thin) + 3000));
          log(
            `   budget wall: ${thin.team} ceiling ${ceilingOf(thin)}, pushing ${name} to ~${target}`,
          );
        }
      }
      const caps: Partial<Record<TeamName, number>> =
        name === STAR ? { "Pune Panthers": 50_000, "Thane Tuskers": 30_000 } : {};
      const result = await sellLot(name, winner, target, { rivalCaps: caps, scenario });

      if (scenario === "clock") {
        // Let the clock run; a rival snipes in the last seconds and gets extended.
        const cd = winner.page.getByTestId("countdown");
        await expect
          .poll(async () => Number(await cd.textContent()), { timeout: 30_000, intervals: [200] })
          .toBeLessThanOrEqual(4);
        const before = Number(await cd.textContent());
        const sniper = owners.find(
          (o) => o !== winner && o.squad < SQUAD && ceilingOf(o) >= nextRung(result.price),
        );
        if (sniper) {
          const amt = nextRung(result.price);
          await bid(sniper, amt);
          const after = Number(await cd.textContent());
          log(`   anti-snipe: ${sniper.team} bid at ${before}s → clock now ${after}s`);
          if (!(after > before))
            note(`anti-snipe did not extend the clock (${before}s → ${after}s)`);
          result.bids += 1;
          result.bidders.push(sniper.team);
          const back = nextRung(amt);
          await bid(winner, back);
          result.bids += 1;
          result.bidders.push(winner.team);
          result.price = back;
          result.leader = winner;
        }
        log("   waiting for the clock to close the lot by itself…");
        await expect(org.getByTestId("cockpit-gavel")).toBeHidden({ timeout: 45_000 });
      } else {
        await gavel();
      }

      // Everyone sees the same outcome.
      await expect(owners[0]!.page.getByTestId("current-lot"))
        .toBeHidden({ timeout: 20_000 })
        .catch(() => {});
      if (result.leader !== winner)
        log(`   (the lot went to ${result.leader.team}, not the planned ${winner.team})`);
      const buyer = result.leader;
      buyer.purse -= result.price;
      buyer.squad += 1;
      const rec: LotRecord = {
        round,
        lotNumber,
        player: name,
        outcome: "sold",
        team: buyer.team,
        price: result.price,
        bids: result.bids,
        bidders: result.bidders,
        scenario,
        ms: Date.now() - t0,
      };
      records.push(rec);
      log(
        `${lotNumber} ${name}: SOLD to ${buyer.team} for ${result.price} after ${result.bids} bids${scenario ? ` [${scenario}]` : ""} [${rec.ms}ms] · purse left ${buyer.purse}, squad ${buyer.squad}`,
      );
      // The owner's own screen agrees with the books.
      await expect
        .poll(async () => points(await buyer.page.getByTestId("my-purse").textContent()), {
          timeout: 10_000,
        })
        .toBe(buyer.purse);
      if (name === STAR) {
        for (const o of owners) {
          const outbids = await o.page.getByText(/^Outbid —/).count();
          log(`   ${o.team} sees ${outbids} "Outbid" toast(s) after the star war`);
          if (outbids > 1) note(`${o.team}: ${outbids} Outbid toasts stacked`);
        }
        await shot(board, "25-board-after-star");
        await shot(winner.page, "26-owner-after-star");
      }

      if (scenario === "undo") {
        // The conductor realises the gavel came down too early, and undoes it.
        await org.getByTestId("cockpit-undo").click();
        await expect(org.getByTestId("undo-summary")).toBeVisible(COLD);
        log(`   undo: ${(await org.getByTestId("undo-summary").textContent())?.trim()}`);
        await org.getByTestId("confirm-undo").click();
        const requeue = org.getByTestId(`requeue-${lotNumber}`);
        await expect(requeue).toBeVisible(COLD);
        winner.purse += result.price;
        winner.squad -= 1;
        records.pop();
        for (const o of owners) {
          await expect(o.page.getByTestId("my-purse")).toBeVisible();
        }
        const shown = points(await winner.page.getByTestId("my-purse").textContent());
        log(`   ${winner.team} purse restored on their screen: ${shown} (model ${winner.purse})`);
        if (shown !== winner.purse)
          note(`after undo ${winner.team} purse shows ${shown}, expected ${winner.purse}`);
        await requeue.click();
        await expect(requeue).toBeHidden(COLD);
        undoDone = true;
        log(`   ${lotNumber} requeued to the top — it will be re-auctioned next`);
      }
    }
  }

  await runRound(1);
  await shot(org, "40-cockpit-after-round-1");
  const r1Unsold = records.filter((r) => r.round === 1 && r.outcome === "unsold").length;
  log(
    `ROUND 1 over: ${records.filter((r) => r.outcome === "sold").length} sold, ${r1Unsold} unsold`,
  );
  for (const o of owners) log(`   ${o.team}: squad ${o.squad}, purse ${o.purse}`);

  // Round 2 — the unsold come back, in one press.
  const requeueAll = org.getByTestId("requeue-all-unsold");
  await expect(requeueAll).toBeVisible(COLD);
  const label = (await requeueAll.textContent())?.trim();
  const t2 = Date.now();
  await requeueAll.click();
  await expect(org.locator('[data-testid^="requeue-L"]')).toHaveCount(0, COLD);
  await expect(requeueAll).toBeHidden();
  await expect(org.getByTestId("cockpit-open-next")).toBeEnabled(COLD);
  log(`   "${label}" → all back in the queue in ${Date.now() - t2}ms`);
  await runRound(2);

  await shot(org, "45-cockpit-before-complete");
  await shot(board, "46-board-end");
  for (const o of owners) await shot(o.page, `47-owner-end-${o.team.split(" ")[0]}`);

  // --- Close the night ----------------------------------------------------------------
  await org.getByTestId("cockpit-complete").click();
  await org.getByRole("dialog").waitFor({ state: "visible", timeout: 20_000 });
  await shot(org, "48-complete-dialog");
  await org.getByTestId("confirm-complete").click();
  const needsReason = await org
    .getByTestId("override-reason")
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (needsReason) note("completion asked for a short-squad override although every squad is full");
  await expect(org.getByTestId("cockpit-finished")).toBeVisible(COLD);
  log("AUCTION COMPLETE");

  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const psorted = [...propagation].sort((a, b) => a - b);
  const ppct = (p: number) =>
    psorted[Math.min(psorted.length - 1, Math.floor((p / 100) * psorted.length))];
  const summary = {
    records,
    owners: owners.map((o) => ({ team: o.team, purse: o.purse, squad: o.squad })),
    bidLatencyMs: {
      n: sorted.length,
      p50: pct(50),
      p90: pct(90),
      p99: pct(99),
      max: sorted.at(-1),
    },
    seenByRivalMs: { p50: ppct(50), p90: ppct(90), max: psorted.at(-1) },
    issues,
    budgetChecks,
  };
  writeFileSync(path.join(OUT, "live-summary.json"), JSON.stringify(summary, null, 2));
  log(
    `bid → own screen p50 ${pct(50)}ms p90 ${pct(90)}ms max ${sorted.at(-1)}ms over ${sorted.length} bids`,
  );
  log(`issues: ${issues.length}`);
  expect(owners.map((o) => o.squad)).toEqual([SQUAD, SQUAD, SQUAD]);
  expect(TEAMS.length).toBe(3);
});
